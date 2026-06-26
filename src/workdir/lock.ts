/**
 * Lockfile read/write for installed skills.
 *
 * The lock.json lives at `<workdir>/.cloudtrik-hub/lock.json` and records:
 *   - Which skills are installed
 *   - Their installed versions
 *   - Their content hashes (used by `update` for hash-match resolution)
 *   - Their install paths relative to the workdir
 *
 * Writes are atomic: write to a tmp file, then rename to the final path.
 * Reads tolerate missing/malformed lockfiles by returning an empty record.
 */

import { mkdir, readFile, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface LockEntry {
  slug: string;
  version: string;
  path: string;
  hash?: string;
  installedAt: number;
}

export interface LockFile {
  entries: Record<string, LockEntry>;
  version: number;
}

const LOCK_VERSION = 1;

export function lockPath(workdir: string): string {
  return join(workdir, '.cloudtrik-hub', 'lock.json');
}

/**
 * Read the lockfile. Returns an empty lockfile if the file is missing or
 * malformed.
 */
export async function readLockFile(workdir: string): Promise<LockFile> {
  const path = lockPath(workdir);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as LockFile;
    if (typeof parsed !== 'object' || parsed === null) return emptyLock();
    return {
      version: typeof parsed.version === 'number' ? parsed.version : LOCK_VERSION,
      entries: typeof parsed.entries === 'object' && parsed.entries !== null ? parsed.entries : {},
    };
  } catch {
    return emptyLock();
  }
}

/**
 * Atomically write the lockfile.
 */
export async function writeLockFile(workdir: string, lock: LockFile): Promise<void> {
  const path = lockPath(workdir);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(lock, null, 2), { encoding: 'utf8' });
  await rename(tmpPath, path);
}

/**
 * Add or replace a lock entry and write the file.
 */
export async function upsertLockEntry(workdir: string, entry: LockEntry): Promise<void> {
  const lock = await readLockFile(workdir);
  lock.entries[entry.slug] = entry;
  await writeLockFile(workdir, lock);
}

/**
 * Remove a lock entry and write the file. No-op if the entry doesn't exist.
 * Returns true if an entry was removed.
 */
export async function removeLockEntry(workdir: string, slug: string): Promise<boolean> {
  const lock = await readLockFile(workdir);
  if (!(slug in lock.entries)) return false;
  delete lock.entries[slug];
  await writeLockFile(workdir, lock);
  return true;
}

/**
 * Remove a directory recursively if it exists; ignore missing paths.
 */
export async function removeDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // tolerate
  }
}

/**
 * Remove a single file if it exists.
 */
export async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // tolerate
  }
}

function emptyLock(): LockFile {
  return { version: LOCK_VERSION, entries: {} };
}
