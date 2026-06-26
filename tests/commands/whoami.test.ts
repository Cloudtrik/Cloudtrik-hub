import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { writeConfig } from '../../src/auth/config.js';
import { join } from 'node:path';

describe('commands/whoami', () => {
  let tempDir: string;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('whoami-cfg-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
  });

  it('throws when no token stored', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'whoami']),
    ).rejects.toThrow(/No auth token|login first/);
  });

  it('prints handle on happy path', async () => {
    await writeConfig({ token: 'tok' });
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/cli/whoami', method: 'GET' })
      .reply(200, { handle: 'alice', displayName: 'Alice' });
    const stdoutWrites: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    const program = buildProgram();
    program.exitOverride();
    try {
      await program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'whoami']);
    } finally {
      process.stdout.write = original;
    }
    expect(stdoutWrites.join('')).toContain('alice');
    expect(stdoutWrites.join('')).toContain('Alice');
  });

  it('throws on non-200 response', async () => {
    await writeConfig({ token: 'tok' });
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool.intercept({ path: '/api/cli/whoami', method: 'GET' }).reply(401, { error: 'invalid' });
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'whoami']),
    ).rejects.toThrow(/HTTP 401|whoami failed/);
  });
});
