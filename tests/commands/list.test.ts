import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';
import { upsertLockEntry } from '../../src/workdir/lock.js';
import { join } from 'node:path';

describe('commands/list', () => {
  let tempDir: string;
  let workdir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('list-cfg-');
    workdir = await makeTempDir('list-workdir-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
    await cleanupTempDir(workdir);
  });

  it('prints "No skills installed" when lockfile empty/missing', async () => {
    const stdoutWrites: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    const program = buildProgram();
    program.exitOverride();
    try {
      await program.parseAsync(['node', 'cli', '--workdir', workdir, 'list']);
    } finally {
      process.stdout.write = original;
    }
    expect(stdoutWrites.join('')).toContain('No skills installed');
  });

  it('prints installed skills when lockfile populated', async () => {
    await upsertLockEntry(workdir, {
      slug: 'foo',
      version: '1.0.0',
      path: join(workdir, 'skills', 'foo'),
      installedAt: Date.now(),
    });
    const stdoutWrites: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    const program = buildProgram();
    program.exitOverride();
    try {
      await program.parseAsync(['node', 'cli', '--workdir', workdir, 'list']);
    } finally {
      process.stdout.write = original;
    }
    const out = stdoutWrites.join('');
    expect(out).toContain('foo@1.0.0');
  });

  it('honors --dir flag (composes lock entries regardless)', async () => {
    await upsertLockEntry(workdir, {
      slug: 'bar',
      version: '2.0.0',
      path: join(workdir, 'custom', 'bar'),
      installedAt: Date.now(),
    });
    const stdoutWrites: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    const program = buildProgram();
    program.exitOverride();
    try {
      await program.parseAsync(['node', 'cli', '--workdir', workdir, '--dir', 'custom', 'list']);
    } finally {
      process.stdout.write = original;
    }
    expect(stdoutWrites.join('')).toContain('bar@2.0.0');
  });
});
