/**
 * `cloudtrik-hub list`
 *
 * Prints installed skills from the lockfile.
 *
 * Exit codes:
 *   0 = success (zero or more entries)
 *   1 = unreadable lockfile (rare; the read path tolerates missing files)
 */

import type { Command } from 'commander';
import { resolveWorkdir } from '../workdir/resolve.js';
import { readLockFile } from '../workdir/lock.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  workdir?: string;
}

export function cmdList(program: Command): void {
  program
    .command('list')
    .description('List installed skills (reads .cloudtrik-hub/lock.json)')
    .action(async (_opts, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const workdirResolution = await resolveWorkdir({ workdir: globalOpts.workdir });
      const lock = await readLockFile(workdirResolution.workdir);
      const entries = Object.values(lock.entries);
      if (entries.length === 0) {
        info('No skills installed');
        return;
      }
      info(`Installed skills in ${workdirResolution.workdir}:`);
      for (const entry of entries) {
        info(`  ${entry.slug}@${entry.version} → ${entry.path}`);
      }
    });
}
