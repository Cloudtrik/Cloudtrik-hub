import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex, hashFile, hashDirectory } from '../../src/util/hash.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';

describe('util/hash', () => {
  it('sha256Hex produces stable hex digest', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('hashFile produces digest matching sha256Hex', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'a.txt');
      await writeFile(path, 'hello', 'utf8');
      const fileHash = await hashFile(path);
      expect(fileHash).toBe(sha256Hex('hello'));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it('hashDirectory is stable across identical trees', async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();
    try {
      await mkdir(join(dir1, 'sub'), { recursive: true });
      await writeFile(join(dir1, 'sub', 'a.txt'), 'A', 'utf8');
      await writeFile(join(dir1, 'b.txt'), 'B', 'utf8');
      await mkdir(join(dir2, 'sub'), { recursive: true });
      await writeFile(join(dir2, 'sub', 'a.txt'), 'A', 'utf8');
      await writeFile(join(dir2, 'b.txt'), 'B', 'utf8');
      const h1 = await hashDirectory(dir1);
      const h2 = await hashDirectory(dir2);
      expect(h1).toBe(h2);
    } finally {
      await cleanupTempDir(dir1);
      await cleanupTempDir(dir2);
    }
  });

  it('hashDirectory diverges when content changes', async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();
    try {
      await writeFile(join(dir1, 'a.txt'), 'one', 'utf8');
      await writeFile(join(dir2, 'a.txt'), 'two', 'utf8');
      const h1 = await hashDirectory(dir1);
      const h2 = await hashDirectory(dir2);
      expect(h1).not.toBe(h2);
    } finally {
      await cleanupTempDir(dir1);
      await cleanupTempDir(dir2);
    }
  });
});
