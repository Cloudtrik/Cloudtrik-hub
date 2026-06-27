import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { join } from 'node:path';

describe('commands/search', () => {
  let tempDir: string;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('search-cfg-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
    delete process.env.CLOUDTRIK_HUB_REGISTRY;
    delete process.env.CLOUDTRIK_HUB_SITE;
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    delete process.env.CLOUDTRIK_HUB_REGISTRY;
    delete process.env.CLOUDTRIK_HUB_SITE;
    await cleanupTempDir(tempDir);
  });

  it('prints results when MockAgent serves a happy-path response', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool.intercept({ path: '/api/search?q=postgres&limit=20', method: 'GET' }).reply(200, {
      results: [
        {
          slug: 'pg-backups',
          ownerHandle: 'alice',
          displayName: 'PG Backups',
          summary: 'Postgres backup automation',
          score: 3.04,
          version: '1.0.0',
          updatedAt: Date.now(),
        },
      ],
    });
    const program = buildProgram();
    program.exitOverride();
    const stdoutWrites: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'search', 'postgres']);
    } finally {
      process.stdout.write = originalWrite;
    }
    const combined = stdoutWrites.join('');
    expect(combined).toContain('pg-backups');
    expect(combined).toContain('alice');
  });

  it('honors --limit flag value', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/search?q=foo&limit=5', method: 'GET' })
      .reply(200, { results: [] });
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'cli',
      '--registry',
      REGISTRY,
      'search',
      'foo',
      '--limit',
      '5',
    ]);
    // Reaching here without throw means the URL matched.
    expect(true).toBe(true);
  });

  it('throws CliError on HTTP error', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/search?q=err&limit=20', method: 'GET' })
      .reply(500, 'server error');
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'search', 'err']),
    ).rejects.toThrow(/HTTP 500|Search failed/);
  });
});
