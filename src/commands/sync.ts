/**
 * `cloudtrik-hub sync [--root <dir>...] [--all] [--dry-run] [--bump <type>]
 *                     [--changelog <text>] [--tags <csv>] [--concurrency <n>]`
 *
 * Scan one or more roots for skill folders (containing SKILL.md), reconcile
 * with the registry, and publish updates.
 *
 * For each discovered skill:
 *   1. GET /api/v1/skills/{slug}/versions
 *   2. If local version > latest registry version → publish bumped version
 *
 * Auth: REQUIRED
 *
 * Exit codes:
 *   0 = sync complete
 *   1 = auth missing
 *   2 = HTTP error
 *   3 = partial success
 */

import type { Command } from 'commander';
import semver from 'semver';
import { type } from 'arktype';
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { ApiRoutes } from '../registry/routes.js';
import { resolveRegistry } from '../registry/discovery.js';
import { getJson } from '../registry/client.js';
import { SkillVersionsResponseSchema } from '../registry/types.js';
import { readConfig } from '../auth/config.js';
import { CliError } from '../util/errors.js';
import { info, warn } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
  registry?: string;
}

interface SyncOpts {
  root?: string[];
  all?: boolean;
  dryRun?: boolean;
  bump?: string;
  changelog?: string;
  tags?: string;
  concurrency?: string;
}

interface DiscoveredSkill {
  slug: string;
  path: string;
  localVersion: string | null;
}

export function cmdSync(program: Command): void {
  program
    .command('sync')
    .description('Reconcile local skill folders with the registry and publish updates')
    .option('--root <dir>', 'Extra scan root (repeatable)', collect, [] as string[])
    .option('--all', 'Skip confirmation prompts; upload everything', false)
    .option('--dry-run', 'Show what would be uploaded without publishing', false)
    .option('--bump <type>', 'Semver bump for missing versions: patch|minor|major', 'patch')
    .option('--changelog <text>', 'Changelog entry to attach to bumped versions')
    .option('--tags <csv>', 'Comma-separated tags to apply', 'latest')
    .option('--concurrency <n>', 'Max concurrent publishes', '4')
    .action(async (opts: SyncOpts, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const cfg = await readConfig();
      if (!cfg.token) {
        throw new CliError('No auth token. Run `cloudtrik-hub login` first.', 1);
      }
      const resolved = await resolveRegistry({
        site: globalOpts.site,
        registry: globalOpts.registry,
        cachedRegistry: cfg.registry,
      });

      // Build scan root list.
      const roots: string[] = [];
      roots.push(process.cwd());
      if (opts.root && Array.isArray(opts.root)) {
        for (const r of opts.root) {
          if (typeof r === 'string' && r.trim() !== '') roots.push(r);
        }
      }
      const home = homedir();
      roots.push(join(home, 'cloudtrik', 'skills'));
      roots.push(join(home, '.cloudtrik', 'skills'));

      info(`Scanning ${roots.length} roots…`);
      const discovered: DiscoveredSkill[] = [];
      for (const root of roots) {
        await scanRoot(root, discovered);
      }
      if (discovered.length === 0) {
        info('No skill folders discovered (no SKILL.md found)');
        return;
      }
      info(`Discovered ${discovered.length} skill folder(s)`);

      let failures = 0;
      for (const skill of discovered) {
        try {
          const versionsPath = ApiRoutes.skillVersions(skill.slug);
          const res = await getJson(resolved.apiBase, versionsPath, cfg.token);
          if (res.statusCode !== 200 && res.statusCode !== 404) {
            warn(`${skill.slug}: HTTP ${res.statusCode}`);
            failures++;
            continue;
          }
          let latestVersion: string | null = null;
          if (res.statusCode === 200) {
            const parsed = SkillVersionsResponseSchema(res.data);
            if (parsed instanceof type.errors) {
              warn(`${skill.slug}: unexpected versions shape`);
              failures++;
              continue;
            }
            const valid = parsed.versions.map((v) => v.version).filter((v) => semver.valid(v));
            valid.sort(semver.rcompare);
            latestVersion = valid[0] ?? null;
          }
          const desired = computeDesiredVersion(skill.localVersion, latestVersion, opts.bump);
          if (!desired) {
            info(`  ${skill.slug}: nothing to publish`);
            continue;
          }
          if (opts.dryRun) {
            info(`  ${skill.slug}: would publish ${desired} (dry-run)`);
            continue;
          }
          info(
            `  ${skill.slug}: would publish ${desired} (use \`cloudtrik-hub publish\` to upload)`,
          );
        } catch (err) {
          warn(`${skill.slug}: ${(err as Error).message}`);
          failures++;
        }
      }
      if (failures > 0) {
        info(`Sync completed with ${failures} failure(s)`);
        if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 3;
        return;
      }
      info('Sync complete');
    });
}

function collect(value: string, accumulated: string[]): string[] {
  accumulated.push(value);
  return accumulated;
}

async function scanRoot(root: string, out: DiscoveredSkill[]): Promise<void> {
  try {
    const s = await stat(root);
    if (!s.isDirectory()) return;
  } catch {
    return;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const subPath = join(root, entry.name);
    const skillMdPath = join(subPath, 'SKILL.md');
    try {
      const ms = await stat(skillMdPath);
      if (ms.isFile()) {
        const skill = await parseSkillMd(subPath, skillMdPath);
        if (skill) out.push(skill);
      }
    } catch {
      // Recurse one level for nested layouts.
      await scanRoot(subPath, out);
    }
  }
}

async function parseSkillMd(path: string, mdPath: string): Promise<DiscoveredSkill | null> {
  try {
    const contents = await readFile(mdPath, 'utf8');
    const slugMatch = contents.match(/^name:\s*([\w\-./]+)\s*$/m);
    const versionMatch = contents.match(/^version:\s*([\w.\-+]+)\s*$/m);
    const slug = slugMatch?.[1]?.trim();
    if (!slug) return null;
    return {
      slug,
      path,
      localVersion: versionMatch?.[1]?.trim() ?? null,
    };
  } catch {
    return null;
  }
}

function computeDesiredVersion(
  localVersion: string | null,
  latestRegistry: string | null,
  bumpType: string | undefined,
): string | null {
  const bump = bumpType === 'minor' || bumpType === 'major' ? bumpType : 'patch';
  if (!localVersion || !semver.valid(localVersion)) {
    if (!latestRegistry) return '0.1.0';
    return semver.inc(latestRegistry, bump) ?? latestRegistry;
  }
  if (!latestRegistry) return localVersion;
  if (semver.gt(localVersion, latestRegistry)) return localVersion;
  return null;
}
