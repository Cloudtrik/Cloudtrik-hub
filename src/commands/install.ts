/**
 * `cloudtrik-hub install <slug> [--version <v>] [--force]`
 *
 * Downloads a skill tarball from the registry, runs the install-time scanner
 * gate against it, and extracts to `<workdir>/<dir>/<slug>/`. Updates the
 * lockfile with the install record.
 *
 * HTTP: GET /api/v1/skills/{slug}/file?version={v}
 * Auth: optional
 * Scanner gate: called BEFORE moving the tarball to its destination.
 *
 * Exit codes:
 *   0 = installed
 *   1 = HTTP error
 *   2 = scanner reject
 *   3 = existing dir + no --force
 *   4 = lockfile conflict
 */

import type { Command } from 'commander';
import { mkdir, stat, rm, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApiRoutes } from '../registry/routes.js';
import { resolveRegistry } from '../registry/discovery.js';
import { getBytes } from '../registry/client.js';
import { resolveWorkdir, skillInstallPath } from '../workdir/resolve.js';
import { upsertLockEntry } from '../workdir/lock.js';
import { extractTarball } from '../util/tar.js';
import { hashDirectory } from '../util/hash.js';
import { scanPluginPackage, formatScannerRejection } from '../scanner/shim.js';
import { readConfig } from '../auth/config.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  workdir?: string;
  dir?: string;
  site?: string;
  registry?: string;
}

export function cmdInstall(program: Command): void {
  program
    .command('install')
    .description('Install a skill from the Cloudtrik registry')
    .argument('<slug>', 'Skill slug to install')
    .option('--version <v>', 'Specific version to install (default: latest)')
    .option('--force', 'Overwrite existing local directory', false)
    .action(async (slug: string, opts: { version?: string; force?: boolean }, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const cfg = await readConfig();
      const resolved = await resolveRegistry({
        site: globalOpts.site,
        registry: globalOpts.registry,
        cachedRegistry: cfg.registry,
      });
      const workdirResolution = await resolveWorkdir({ workdir: globalOpts.workdir });
      const dir = globalOpts.dir ?? 'skills';
      const installDir = skillInstallPath(workdirResolution.workdir, slug, dir);

      // Check for existing install.
      if (!opts.force && (await exists(installDir))) {
        throw new CliError(
          `${slug} is already installed at ${installDir}. Pass --force to overwrite.`,
          3,
        );
      }

      // Download tarball.
      const downloadPath =
        ApiRoutes.skillFile(slug) +
        (opts.version ? `?version=${encodeURIComponent(opts.version)}` : '');
      info(`Downloading ${slug}${opts.version ? ` @ ${opts.version}` : ''}…`);
      const tarballBytes = await getBytes(resolved.apiBase, downloadPath, cfg.token);

      // Stage tarball to a temp directory and run scanner gate BEFORE moving.
      const stageDir = join(tmpdir(), `cloudtrik-hub-install-${slug}-${process.pid}-${Date.now()}`);
      await mkdir(stageDir, { recursive: true });
      try {
        await extractTarball(tarballBytes, stageDir);
        const report = await scanPluginPackage(stageDir);
        if (!report.ok) {
          throw new CliError(formatScannerRejection(report), 2);
        }

        // Move staged contents into final install directory.
        if (opts.force) {
          await rm(installDir, { recursive: true, force: true });
        }
        await mkdir(installDir, { recursive: true });
        await copyDirectory(stageDir, installDir);

        const hash = await hashDirectory(installDir);
        await upsertLockEntry(workdirResolution.workdir, {
          slug,
          version: opts.version ?? 'latest',
          path: installDir,
          hash,
          installedAt: Date.now(),
        });
        info(`Installed ${slug} to ${installDir}`);
      } finally {
        await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
      }
    });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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
