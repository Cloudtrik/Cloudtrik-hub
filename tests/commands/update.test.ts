import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { writeConfig } from '../../src/auth/config.js';
import { upsertLockEntry } from '../../src/workdir/lock.js';
import { setScannerAdapter } from '../../src/scanner/shim.js';
import { packDirectory } from '../../src/util/tar.js';
import { hashDirectory } from '../../src/util/hash.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('commands/update', () => {
  let tempDir: string;
  let workdir: string;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('update-cfg-');
    workdir = await makeTempDir('update-workdir-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
    await writeConfig({ token: 'tok' });
  });

  afterEach(async () => {
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
    await cleanupTempDir(workdir);
  });

  async function buildSampleTarball(): Promise<Uint8Array> {
    const src = await makeTempDir('update-src-');
    try {
      await mkdir(src, { recursive: true });
      await writeFile(join(src, 'SKILL.md'), '---\nname: my-skill\nversion: 1.0.1\n---\n', 'utf8');
      return await packDirectory(src);
    } finally {
      await cleanupTempDir(src);
    }
  }

  it('throws when slug not installed and --all absent', async () => {
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
        'update',
        'absent',
      ]),
    ).rejects.toThrow(/not installed/);
  });

  it('treats matching local hash + newer registry as upgrade', async () => {
    // Stage an installed skill so its directory hash is known.
    const installDir = join(workdir, 'skills', 'my-skill');
    await mkdir(installDir, { recursive: true });
    await writeFile(join(installDir, 'SKILL.md'), 'snapshot', 'utf8');
    const localHash = await hashDirectory(installDir);

    await upsertLockEntry(workdir, {
      slug: 'my-skill',
      version: '1.0.0',
      path: installDir,
      hash: localHash,
      installedAt: Date.now(),
    });

    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool.intercept({ path: '/api/v1/skills/my-skill/versions', method: 'GET' }).reply(200, {
      versions: [
        { version: '1.0.0', sha256: localHash },
        { version: '1.0.1', sha256: 'new-hash' },
      ],
    });
    pool
      .intercept({ path: '/api/v1/skills/my-skill/file?version=1.0.1', method: 'GET' })
      .reply(200, Buffer.from(await buildSampleTarball()));

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'cli',
      '--registry',
      REGISTRY,
      '--workdir',
      workdir,
      'update',
      'my-skill',
    ]);
  });

  it('--all on empty lock prints nothing-to-update', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'cli',
      '--registry',
      REGISTRY,
      '--workdir',
      workdir,
      'update',
      '--all',
    ]);
  });
});
