import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { writeConfig, readToken } from '../../src/auth/config.js';
import { join } from 'node:path';

describe('commands/logout', () => {
  let tempDir: string;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('logout-cfg-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
  });

  it('clears token from config', async () => {
    await writeConfig({ token: 'will-be-cleared' });
    expect(await readToken()).toBe('will-be-cleared');
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool.intercept({ path: '/api/cli/logout', method: 'POST' }).reply(204, '');
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'logout']);
    expect(await readToken()).toBeUndefined();
  });

  it('succeeds with no stored token (idempotent)', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'logout']);
    expect(await readToken()).toBeUndefined();
  });

  it('tolerates server best-effort failure', async () => {
    await writeConfig({ token: 'tok' });
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool.intercept({ path: '/api/cli/logout', method: 'POST' }).reply(500, 'server explosion');
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'logout']);
    expect(await readToken()).toBeUndefined();
  });
});
