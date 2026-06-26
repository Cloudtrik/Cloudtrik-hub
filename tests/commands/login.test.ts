import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';
import { readToken } from '../../src/auth/config.js';
import { join } from 'node:path';

describe('commands/login', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('login-cfg-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
  });

  it('stores token via --token path', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', 'login', '--token', 'paste-token-xyz']);
    expect(await readToken()).toBe('paste-token-xyz');
  });

  it('stores token + label', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', 'login', '--token', 'tok', '--label', 'my-cli']);
    expect(await readToken()).toBe('tok');
  });

  it('throws when --no-browser supplied without --token', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(program.parseAsync(['node', 'cli', 'login', '--no-browser'])).rejects.toThrow(
      /no --token|--token/,
    );
  });
});
