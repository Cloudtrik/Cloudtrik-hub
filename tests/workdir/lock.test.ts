import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readLockFile,
  writeLockFile,
  upsertLockEntry,
  removeLockEntry,
  lockPath,
} from '../../src/workdir/lock.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';

describe('workdir/lock', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('cloudtrik-hub-lock-');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('lockPath composes the canonical path', () => {
    expect(lockPath(tempDir)).toContain('.cloudtrik-hub');
    expect(lockPath(tempDir).endsWith('lock.json')).toBe(true);
  });

  it('readLockFile returns empty lock when missing', async () => {
    const lock = await readLockFile(tempDir);
    expect(lock.entries).toEqual({});
  });

  it('writeLockFile + readLockFile round-trips', async () => {
    await writeLockFile(tempDir, {
      version: 1,
      entries: {
        foo: { slug: 'foo', version: '1.2.3', path: '/p/foo', installedAt: 1 },
      },
    });
    const lock = await readLockFile(tempDir);
    expect(lock.entries.foo?.version).toBe('1.2.3');
  });

  it('upsertLockEntry adds and replaces entries', async () => {
    await upsertLockEntry(tempDir, {
      slug: 'foo',
      version: '1.0.0',
      path: '/p/foo',
      installedAt: 1,
    });
    await upsertLockEntry(tempDir, {
      slug: 'bar',
      version: '2.0.0',
      path: '/p/bar',
      installedAt: 2,
    });
    const lock = await readLockFile(tempDir);
    expect(Object.keys(lock.entries).sort()).toEqual(['bar', 'foo']);
    await upsertLockEntry(tempDir, {
      slug: 'foo',
      version: '1.0.1',
      path: '/p/foo',
      installedAt: 3,
    });
    const lock2 = await readLockFile(tempDir);
    expect(lock2.entries.foo?.version).toBe('1.0.1');
  });

  it('removeLockEntry returns false when entry missing', async () => {
    const removed = await removeLockEntry(tempDir, 'absent');
    expect(removed).toBe(false);
  });

  it('removeLockEntry returns true and deletes entry', async () => {
    await upsertLockEntry(tempDir, {
      slug: 'foo',
      version: '1.0.0',
      path: '/p/foo',
      installedAt: 1,
    });
    const removed = await removeLockEntry(tempDir, 'foo');
    expect(removed).toBe(true);
    const lock = await readLockFile(tempDir);
    expect(lock.entries.foo).toBeUndefined();
  });
});
