import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packDirectory, extractTarball } from '../../src/util/tar.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';

describe('util/tar', () => {
  it('packDirectory then extractTarball round-trips file content', async () => {
    const src = await makeTempDir();
    const dst = await makeTempDir();
    try {
      await mkdir(join(src, 'nested'), { recursive: true });
      await writeFile(join(src, 'root.txt'), 'root', 'utf8');
      await writeFile(join(src, 'nested', 'inner.txt'), 'inner', 'utf8');
      const tarballBytes = await packDirectory(src);
      expect(tarballBytes.byteLength).toBeGreaterThan(0);
      await extractTarball(tarballBytes, dst);
      const rootRead = await readFile(join(dst, 'root.txt'), 'utf8');
      const innerRead = await readFile(join(dst, 'nested', 'inner.txt'), 'utf8');
      expect(rootRead).toBe('root');
      expect(innerRead).toBe('inner');
    } finally {
      await cleanupTempDir(src);
      await cleanupTempDir(dst);
    }
  });

  it('packDirectory honors ignore callback', async () => {
    const src = await makeTempDir();
    const dst = await makeTempDir();
    try {
      await writeFile(join(src, 'keep.txt'), 'keep', 'utf8');
      await writeFile(join(src, 'skip.txt'), 'skip', 'utf8');
      const tarballBytes = await packDirectory(src, (rel) => rel === 'skip.txt');
      await extractTarball(tarballBytes, dst);
      const keep = await readFile(join(dst, 'keep.txt'), 'utf8');
      expect(keep).toBe('keep');
      let skipRead: string | null = null;
      try {
        skipRead = await readFile(join(dst, 'skip.txt'), 'utf8');
      } catch {
        skipRead = null;
      }
      expect(skipRead).toBeNull();
    } finally {
      await cleanupTempDir(src);
      await cleanupTempDir(dst);
    }
  });
});
