import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { writeConfig } from '../../src/auth/config.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('commands/sync', () => {
  let tempDir: string;
  let rootDir: string;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('sync-cfg-');
    rootDir = await makeTempDir('sync-root-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
    await writeConfig({ token: 'tok' });
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
    await cleanupTempDir(rootDir);
  });

  it('throws when no auth token', async () => {
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'missing.json');
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'sync', '--dry-run']),
    ).rejects.toThrow(/No auth token|login first/);
  });

  it('reports zero discoveries when no SKILL.md found', async () => {
    const program = buildProgram();
    program.exitOverride();
    // sync scans cwd; we set cwd via process.chdir.
    const originalCwd = process.cwd();
    try {
      process.chdir(rootDir);
      await program.parseAsync(['node', 'cli', '--registry', REGISTRY, 'sync', '--dry-run']);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('discovers skills via --root and reports dry-run', async () => {
    const skillDir = join(rootDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\nversion: 1.0.0\n---\n',
      'utf8',
    );
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/v1/skills/my-skill/versions', method: 'GET' })
      .reply(404, 'unknown');
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'cli',
      '--registry',
      REGISTRY,
      'sync',
      '--root',
      rootDir,
      '--dry-run',
    ]);
  });
});
