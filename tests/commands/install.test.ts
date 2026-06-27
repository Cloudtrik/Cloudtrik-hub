import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { setScannerAdapter } from '../../src/scanner/shim.js';
import { packDirectory } from '../../src/util/tar.js';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

describe('commands/install', () => {
  let tempDir: string;
  let workdir: string;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('install-cfg-');
    workdir = await makeTempDir('install-workdir-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
    await cleanupTempDir(workdir);
  });

  async function buildSampleTarball(): Promise<Uint8Array> {
    const src = await makeTempDir('install-src-');
    try {
      await mkdir(src, { recursive: true });
      await writeFile(join(src, 'SKILL.md'), '---\nname: my-skill\nversion: 1.0.0\n---\n', 'utf8');
      await writeFile(join(src, 'index.txt'), 'payload', 'utf8');
      return await packDirectory(src);
    } finally {
      await cleanupTempDir(src);
    }
  }

  it('downloads + extracts + records lock entry on happy path', async () => {
    const tarball = await buildSampleTarball();
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/v1/skills/my-skill/file', method: 'GET' })
      .reply(200, Buffer.from(tarball));
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'cli',
      '--registry',
      REGISTRY,
      '--workdir',
      workdir,
      'install',
      'my-skill',
    ]);
    const installPath = join(workdir, 'skills', 'my-skill');
    const lockPath = join(workdir, '.cloudtrik-hub', 'lock.json');
    const installStat = await stat(installPath);
    expect(installStat.isDirectory()).toBe(true);
    const lockStat = await stat(lockPath);
    expect(lockStat.isFile()).toBe(true);
  });

  it('rejects install when scanner adapter returns ok=false', async () => {
    const tarball = await buildSampleTarball();
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/v1/skills/bad-skill/file', method: 'GET' })
      .reply(200, Buffer.from(tarball));
    setScannerAdapter({
      scan: async (target) => ({
        target,
        findings: [{ tool: 'gitleaks', severity: 'critical', rule: 'aws-key', message: 'leaked' }],
        criticalCount: 1,
        ok: false,
        durationMs: 1,
        toolErrors: [],
      }),
    });
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        '--workdir',
        workdir,
        'install',
        'bad-skill',
      ]),
    ).rejects.toThrow(/REJECTED|leaked/);
  });

  it('refuses to overwrite existing install without --force', async () => {
    const tarball = await buildSampleTarball();
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool
      .intercept({ path: '/api/v1/skills/twice/file', method: 'GET' })
      .reply(200, Buffer.from(tarball));
    pool
      .intercept({ path: '/api/v1/skills/twice/file', method: 'GET' })
      .reply(200, Buffer.from(tarball));
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'cli',
      '--registry',
      REGISTRY,
      '--workdir',
      workdir,
      'install',
      'twice',
    ]);
    const program2 = buildProgram();
    program2.exitOverride();
    await expect(
      program2.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        '--workdir',
        workdir,
        'install',
        'twice',
      ]),
    ).rejects.toThrow(/already installed|--force/);
  });
});
