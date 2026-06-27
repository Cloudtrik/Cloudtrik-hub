import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';
import { upsertLockEntry, readLockFile } from '../../src/workdir/lock.js';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

describe('commands/uninstall', () => {
  let tempDir: string;
  let workdir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('uninstall-cfg-');
    workdir = await makeTempDir('uninstall-workdir-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
    await cleanupTempDir(workdir);
  });

  it('removes install directory and lockfile entry', async () => {
    const installDir = join(workdir, 'skills', 'foo');
    await mkdir(installDir, { recursive: true });
    await writeFile(join(installDir, 'x.txt'), 'x', 'utf8');
    await upsertLockEntry(workdir, {
      slug: 'foo',
      version: '1.0.0',
      path: installDir,
      installedAt: Date.now(),
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', '--workdir', workdir, 'uninstall', 'foo']);

    let installExists = true;
    try {
      await stat(installDir);
    } catch {
      installExists = false;
    }
    expect(installExists).toBe(false);

    const lock = await readLockFile(workdir);
    expect(lock.entries.foo).toBeUndefined();
  });

  it('throws when slug not installed', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'cli', '--workdir', workdir, 'uninstall', 'never-installed']),
    ).rejects.toThrow(/not installed/);
  });
});
