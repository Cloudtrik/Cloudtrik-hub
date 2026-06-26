import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { writeConfig } from '../../src/auth/config.js';
import { join } from 'node:path';

describe('commands/undelete', () => {
  let tempDir: string;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('undelete-cfg-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
    await writeConfig({ token: 'tok' });
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
  });

  it('refuses without --yes', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'undelete', 'foo']),
    ).rejects.toThrow(/--yes/);
  });

  it('succeeds on 200', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/v1/skills/foo/undelete', method: 'POST' })
      .reply(200, { ok: true });
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'undelete', 'foo', '--yes']);
  });

  it('throws on 403', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/v1/skills/foo/undelete', method: 'POST' })
      .reply(403, { error: 'denied' });
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'undelete', 'foo', '--yes']),
    ).rejects.toThrow(/Not authorized/);
  });
});
