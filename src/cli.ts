/**
 * Cloudtrik-hub CLI root.
 *
 * Exports buildProgram() — composable Commander Program — so tests can
 * exercise the program tree without running parseAsync.
 *
 * Exports runCli(argv) — convenience parseAsync wrapper.
 *
 * Per Pitfall 6 ("Module-load-time side effects break test runners"), the
 * top-level invocation is GUARDED: parseAsync only runs when this module is
 * the program entry point. Vitest imports of this file do NOT trigger
 * argv parsing.
 */

import { Command } from 'commander';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getCliVersion, getCliName } from './util/build-info.js';
import { explainError } from './util/errors.js';
import { error } from './util/ui.js';
import { cmdSearch } from './commands/search.js';
import { cmdInstall } from './commands/install.js';
import { cmdUpdate } from './commands/update.js';
import { cmdPublish } from './commands/publish.js';
import { cmdList } from './commands/list.js';
import { cmdLogin } from './commands/login.js';
import { cmdLogout } from './commands/logout.js';
import { cmdWhoami } from './commands/whoami.js';
import { cmdSync } from './commands/sync.js';
import { cmdDelete } from './commands/delete.js';
import { cmdUndelete } from './commands/undelete.js';
import { cmdUninstall } from './commands/uninstall.js';

/**
 * Construct the Commander Program tree. Pure function — no side effects.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name(getCliName())
    .description(
      'Cloudtrik-Hub CLI — search, install, update, publish agent skills from the Cloudtrik registry.',
    )
    .version(getCliVersion(), '-V, --cli-version', 'Show CLI version')
    .option(
      '--workdir <dir>',
      'Working directory (default: cwd; falls back to Cloudtrik workspace)',
    )
    .option('--dir <dir>', 'Skills directory relative to workdir (default: skills)')
    .option('--site <url>', 'Site base URL (for browser login)')
    .option('--registry <url>', 'Registry API base URL (overrides discovery)')
    .option('--no-input', 'Disable prompts (non-interactive)');

  cmdSearch(program);
  cmdInstall(program);
  cmdUpdate(program);
  cmdPublish(program);
  cmdList(program);
  cmdLogin(program);
  cmdLogout(program);
  cmdWhoami(program);
  cmdSync(program);
  cmdDelete(program);
  cmdUndelete(program);
  cmdUninstall(program);

  return program;
}

/**
 * Parse argv against the program tree and exit appropriately on error.
 * Wraps every command in a typed-error handler so handlers throw CliError
 * instead of calling process.exit().
 */
export async function runCli(argv: string[]): Promise<number> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err) {
    // commander's CommanderError carries its own exitCode for built-in cases
    // (help, version, unknown command); honor those and exit cleanly.
    const ce = err as { code?: string; exitCode?: number };
    if (ce && typeof ce.code === 'string' && ce.code.startsWith('commander.')) {
      return typeof ce.exitCode === 'number' ? ce.exitCode : 0;
    }
    const { message, exitCode, hint } = explainError(err);
    error(message);
    if (hint) error(`hint: ${hint}`);
    return exitCode;
  }
}

/**
 * Guarded top-level invocation. Only fires when this module is the program
 * entry point (e.g. invoked via `node dist/cli.js`). Imports for testing
 * never trigger argv parsing.
 */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const code = await runCli(process.argv);
  if (code !== 0) {
    process.exit(code);
  }
}
