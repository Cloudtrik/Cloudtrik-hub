/**
 * Content hashing utilities for skill packages.
 *
 * Used by `update` command to determine if local files match any published
 * version (allowing automatic upgrade) or have diverged (requiring `--force`).
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * Return the SHA-256 hex digest of a UTF-8 string.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Return the SHA-256 hex digest of a single file's raw bytes.
 */
export async function hashFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Walk a directory tree and produce a deterministic hash digest representing
 * the entire content of the directory (paths + file contents).
 *
 * The hash is computed by concatenating `<relpath>\t<filehash>\n` lines in
 * sorted order, then SHA-256 hashing the result. Two trees with identical
 * file paths + contents produce identical hashes regardless of mtime / inode.
 */
export async function hashDirectory(root: string): Promise<string> {
  const lines: string[] = [];
  await walk(root, root, lines);
  lines.sort();
  return sha256Hex(lines.join('\n'));
}

async function walk(absPath: string, rootPath: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(absPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.cloudtrik-hub') {
      continue;
    }
    const full = join(absPath, entry.name);
    if (entry.isDirectory()) {
      await walk(full, rootPath, out);
    } else if (entry.isFile()) {
      const rel = relative(rootPath, full).split(sep).join('/');
      const digest = await hashFile(full);
      out.push(`${rel}\t${digest}`);
    }
  }
}

/**
 * Stat-only file existence check that returns true if the path refers to a file.
 */
export async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}
