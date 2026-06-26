/**
 * `cloudtrik-hub update [<slug>] [--all] [--version <v>] [--force] [--no-input]`
 *
 * Updates installed skills. For each target:
 *   1. List published versions
 *   2. Hash the local install directory
 *   3. If local hash matches a published version AND a newer version exists,
 *      download and install the newer version
 *   4. If local hash does NOT match any published version, refuse unless
 *      --force is supplied
 *
 * HTTP:
 *   GET /api/v1/skills/{slug}/versions (list)
 *   GET /api/v1/skills/{slug}/file?version={v} (download)
 *
 * Exit codes:
 *   0 = all up to date or upgrades applied
 *   1 = HTTP error
 *   2 = hash mismatch with no --force
 *   3 = scanner reject
 */

import type { Command } from 'commander';
import semver from 'semver';
import { type } from 'arktype';
import { mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApiRoutes } from '../registry/routes.js';
import { resolveRegistry } from '../registry/discovery.js';
import { getBytes, getJson } from '../registry/client.js';
import { resolveWorkdir, skillInstallPath } from '../workdir/resolve.js';
import { readLockFile, upsertLockEntry, type LockEntry } from '../workdir/lock.js';
import { extractTarball } from '../util/tar.js';
import { hashDirectory } from '../util/hash.js';
import { scanPluginPackage, formatScannerRejection } from '../scanner/shim.js';
import { readConfig } from '../auth/config.js';
import { SkillVersionsResponseSchema } from '../registry/types.js';
import { CliError } from '../util/errors.js';
import { info, warn } from '../util/ui.js';

interface GlobalOpts {
  workdir?: string;
  dir?: string;
  site?: string;
  registry?: string;
}

export function cmdUpdate(program: Command): void {
  program
    .command('update')
    .description('Update installed skills (hash-based match + upgrade)')
    .argument('[slug]', 'Specific skill to update (omit with --all)')
    .option('--all', 'Update every installed skill', false)
    .option('--version <v>', 'Pin to a specific version (single slug only)')
    .option('--force', 'Overwrite when local hash does not match any published version', false)
    .option('--no-input', 'Disable prompts (non-interactive)', false)
    .action(
      async (
        slugArg: string | undefined,
        opts: { all?: boolean; version?: string; force?: boolean; input?: boolean },
        cmd,
      ) => {
        const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
        const cfg = await readConfig();
        const resolved = await resolveRegistry({
          site: globalOpts.site,
          registry: globalOpts.registry,
          cachedRegistry: cfg.registry,
        });
        const workdirResolution = await resolveWorkdir({ workdir: globalOpts.workdir });
        const lock = await readLockFile(workdirResolution.workdir);
        const dir = globalOpts.dir ?? 'skills';

        let targets: LockEntry[];
        if (opts.all) {
          targets = Object.values(lock.entries);
          if (opts.version) {
            throw new CliError('--version cannot be used with --all', 1);
          }
        } else {
          if (!slugArg) {
            throw new CliError('Specify a slug or pass --all', 1);
          }
          const entry = lock.entries[slugArg];
          if (!entry) {
            throw new CliError(`${slugArg} is not installed`, 1);
          }
          targets = [entry];
        }

        if (targets.length === 0) {
          info('No installed skills to update');
          return;
        }

        let updated = 0;
        let skipped = 0;
        for (const target of targets) {
          info(`Checking ${target.slug}…`);
          const versionsPath = ApiRoutes.skillVersions(target.slug);
          const versionsRes = await getJson(resolved.apiBase, versionsPath, cfg.token);
          if (versionsRes.statusCode !== 200) {
            throw new CliError(
              `Failed to fetch versions for ${target.slug}: HTTP ${versionsRes.statusCode}`,
              1,
            );
          }
          const parsed = SkillVersionsResponseSchema(versionsRes.data);
          if (parsed instanceof type.errors) {
            throw new CliError(`Unexpected versions response shape for ${target.slug}`, 1);
          }
          if (parsed.versions.length === 0) {
            info(`  ${target.slug}: no versions available`);
            skipped++;
            continue;
          }

          // Determine desired version.
          const desired =
            opts.version ??
            parsed.versions
              .map((v) => v.version)
              .filter((v) => semver.valid(v))
              .sort(semver.rcompare)[0] ??
            parsed.versions[0]?.version;
          if (!desired) {
            info(`  ${target.slug}: no installable version found`);
            skipped++;
            continue;
          }
          if (desired === target.version && target.version !== 'latest') {
            info(`  ${target.slug}: already at ${desired}`);
            skipped++;
            continue;
          }

          // Hash-match check.
          const localHash = await hashDirectory(target.path);
          const matchedRegistryEntry = parsed.versions.find(
            (v) => v.sha256 && v.sha256 === localHash,
          );
          if (!matchedRegistryEntry && !opts.force) {
            warn(
              `${target.slug}: local files do not match any published version; ` +
                `pass --force to overwrite`,
            );
            skipped++;
            if (process.exitCode === undefined || process.exitCode === 0) {
              process.exitCode = 2;
            }
            continue;
          }

          // Download + scanner gate + replace.
          const downloadPath =
            ApiRoutes.skillFile(target.slug) + `?version=${encodeURIComponent(desired)}`;
          info(`  Downloading ${target.slug}@${desired}…`);
          const tarballBytes = await getBytes(resolved.apiBase, downloadPath, cfg.token);
          const stageDir = join(
            tmpdir(),
            `cloudtrik-hub-update-${target.slug}-${process.pid}-${Date.now()}`,
          );
          await mkdir(stageDir, { recursive: true });
          try {
            await extractTarball(tarballBytes, stageDir);
            const report = await scanPluginPackage(stageDir);
            if (!report.ok) {
              throw new CliError(formatScannerRejection(report), 3);
            }
            const installDir = skillInstallPath(workdirResolution.workdir, target.slug, dir);
            await rm(installDir, { recursive: true, force: true });
            await mkdir(installDir, { recursive: true });
            await copyDirectory(stageDir, installDir);
            const newHash = await hashDirectory(installDir);
            await upsertLockEntry(workdirResolution.workdir, {
              slug: target.slug,
              version: desired,
              path: installDir,
              hash: newHash,
              installedAt: Date.now(),
            });
            info(`  Updated ${target.slug} → ${desired}`);
            updated++;
          } finally {
            await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
          }
        }

        info(`Update summary: ${updated} updated, ${skipped} skipped`);
      },
    );
}

async function copyDirectory(source: string, dest: string): Promise<void> {
  const items = await readdir(source, { withFileTypes: true });
  for (const item of items) {
    const srcPath = join(source, item.name);
    const dstPath = join(dest, item.name);
    if (item.isDirectory()) {
      await mkdir(dstPath, { recursive: true });
      await copyDirectory(srcPath, dstPath);
    } else if (item.isFile()) {
      await copyFile(srcPath, dstPath);
    }
  }
}
