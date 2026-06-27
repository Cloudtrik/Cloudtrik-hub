/**
 * `cloudtrik-hub uninstall <slug>`
 *
 * Remove an installed skill from the local workdir + lockfile.
 *
 * Exit codes:
 *   0 = uninstalled
 *   1 = not installed
 *   2 = filesystem error
 */

import type { Command } from 'commander';
import { resolveWorkdir, skillInstallPath } from '../workdir/resolve.js';
import { readLockFile, removeLockEntry, removeDir } from '../workdir/lock.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  workdir?: string;
  dir?: string;
}

export function cmdUninstall(program: Command): void {
  program
    .command('uninstall')
    .description('Remove an installed skill')
    .argument('<slug>', 'Skill slug to remove')
    .action(async (slug: string, _opts, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const workdirResolution = await resolveWorkdir({ workdir: globalOpts.workdir });
      const dir = globalOpts.dir ?? 'skills';
      const lock = await readLockFile(workdirResolution.workdir);
      const entry = lock.entries[slug];
      if (!entry) {
        throw new CliError(`${slug} is not installed`, 1);
      }
      const installDir =
        entry.path && entry.path !== ''
          ? entry.path
          : skillInstallPath(workdirResolution.workdir, slug, dir);
      try {
        await removeDir(installDir);
      } catch (err) {
        throw new CliError(`Failed to remove ${installDir}: ${(err as Error).message}`, 2);
      }
      await removeLockEntry(workdirResolution.workdir, slug);
      info(`Uninstalled ${slug}`);
    });
}
