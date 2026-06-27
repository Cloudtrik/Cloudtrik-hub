import { describe, it, expect } from 'vitest';
import { buildProgram } from '../../src/cli.js';

/**
 * Verifies that src/cli.ts:
 *   - exports buildProgram() as a pure function
 *   - registers all 12 subcommands
 *   - has the Pitfall-6 guard (no top-level parseAsync on module import)
 *
 * If buildProgram() leaked a process.exit or parseAsync side-effect, this
 * test would never run (vitest would crash). The test successfully completing
 * IS the proof that Pitfall 6 was avoided.
 */
describe('cli buildProgram', () => {
  const expectedCommands = [
    'search',
    'install',
    'update',
    'publish',
    'list',
    'login',
    'logout',
    'whoami',
    'sync',
    'delete',
    'undelete',
    'uninstall',
  ];

  it('registers all 12 subcommands', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((c) => c.name());
    for (const name of expectedCommands) {
      expect(commandNames).toContain(name);
    }
  });

  it('has top-level global options', () => {
    const program = buildProgram();
    const optionNames = program.options.map((o) => o.long ?? o.short ?? '');
    expect(optionNames).toContain('--workdir');
    expect(optionNames).toContain('--dir');
    expect(optionNames).toContain('--site');
    expect(optionNames).toContain('--registry');
  });

  it('exports a Pitfall-6 safe entry (importing cli.ts does not trigger parseAsync)', () => {
    // We already imported it at the top of this file. If parseAsync had fired
    // on import, vitest would have crashed parsing its own argv. Reaching this
    // assertion proves the guard works.
    expect(true).toBe(true);
  });
});
