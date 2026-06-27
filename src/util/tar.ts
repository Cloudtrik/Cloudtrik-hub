/**
 * Tar+gzip pack and extract wrappers built on `fflate` (pure JS — no native deps).
 *
 * Used by:
 *   - publish: pack a skill folder into a `.tgz` tarball for upload
 *   - install/update: extract a downloaded tarball into the skills workdir
 */

import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'fflate';

/**
 * In-memory tar entry header (POSIX ustar subset; sufficient for npm-style tarballs).
 */
interface TarEntry {
  name: string;
  type: 'file' | 'dir';
  mode: number;
  size: number;
  body: Uint8Array;
}

/**
 * Pack a directory tree into a gzipped tarball (.tgz) byte stream.
 * Honors the `ignore` filter callback: when it returns true for a relative path,
 * that file is excluded.
 */
export async function packDirectory(
  rootDir: string,
  ignore: (relPath: string) => boolean = () => false,
): Promise<Uint8Array> {
  const entries: TarEntry[] = [];
  await collectEntries(rootDir, rootDir, entries, ignore);
  const tarBytes = encodeTar(entries);
  return gzipSync(tarBytes);
}

/**
 * Extract a gzipped tarball into the target directory.
 * Returns the list of extracted relative paths.
 */
export async function extractTarball(tgzBytes: Uint8Array, targetDir: string): Promise<string[]> {
  const tarBytes = gunzipSync(tgzBytes);
  const entries = decodeTar(tarBytes);
  const written: string[] = [];
  for (const entry of entries) {
    const outPath = join(targetDir, entry.name);
    if (entry.type === 'dir') {
      await mkdir(outPath, { recursive: true });
    } else {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, Buffer.from(entry.body));
      written.push(entry.name);
    }
  }
  return written;
}

async function collectEntries(
  absPath: string,
  rootPath: string,
  out: TarEntry[],
  ignore: (relPath: string) => boolean,
): Promise<void> {
  const items = await readdir(absPath, { withFileTypes: true });
  for (const item of items) {
    if (item.name === '.git' || item.name === 'node_modules') continue;
    const full = join(absPath, item.name);
    const rel = relative(rootPath, full).split(sep).join('/');
    if (ignore(rel)) continue;
    const s = await stat(full);
    if (item.isDirectory()) {
      out.push({
        name: rel + '/',
        type: 'dir',
        mode: s.mode & 0o7777,
        size: 0,
        body: new Uint8Array(0),
      });
      await collectEntries(full, rootPath, out, ignore);
    } else if (item.isFile()) {
      const body = await readFile(full);
      out.push({
        name: rel,
        type: 'file',
        mode: s.mode & 0o7777,
        size: body.length,
        body: new Uint8Array(body),
      });
    }
  }
}

// Minimal POSIX ustar tar encoder (sufficient for npm-style upload payloads).
function encodeTar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = buildHeader(entry);
    blocks.push(header);
    if (entry.type === 'file' && entry.size > 0) {
      blocks.push(entry.body);
      const padLen = (512 - (entry.size % 512)) % 512;
      if (padLen > 0) blocks.push(new Uint8Array(padLen));
    }
  }
  // Two empty 512-byte blocks to mark end-of-archive.
  blocks.push(new Uint8Array(1024));
  let total = 0;
  for (const b of blocks) total += b.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

function buildHeader(entry: TarEntry): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  writeString(header, enc.encode(entry.name.slice(0, 100)), 0);
  writeOctal(header, entry.mode, 100, 8);
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, entry.size, 124, 12);
  writeOctal(header, Math.floor(Date.now() / 1000), 136, 12); // mtime
  // checksum placeholder of spaces
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = entry.type === 'dir' ? 0x35 /* '5' */ : 0x30 /* '0' */;
  writeString(header, enc.encode('ustar  '), 257);
  // compute checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  writeOctal(header, sum, 148, 7);
  header[155] = 0x20;
  return header;
}

function writeString(buf: Uint8Array, src: Uint8Array, offset: number): void {
  for (let i = 0; i < src.length; i++) {
    buf[offset + i] = src[i] ?? 0;
  }
}

function writeOctal(buf: Uint8Array, value: number, offset: number, length: number): void {
  const str = value.toString(8).padStart(length - 1, '0');
  const enc = new TextEncoder().encode(str);
  writeString(buf, enc, offset);
  buf[offset + length - 1] = 0;
}

function decodeTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  const dec = new TextDecoder();
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    // End of archive: two zero blocks.
    if (header.every((b) => b === 0)) break;
    const name = readString(header, 0, 100, dec);
    if (name === '') {
      offset += 512;
      continue;
    }
    const mode = readOctal(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const typeFlag = header[156] ?? 0;
    const type: 'file' | 'dir' = typeFlag === 0x35 ? 'dir' : 'file';
    offset += 512;
    const body = type === 'file' ? bytes.subarray(offset, offset + size) : new Uint8Array(0);
    entries.push({ name, type, mode, size, body });
    if (size > 0) {
      const padded = Math.ceil(size / 512) * 512;
      offset += padded;
    }
  }
  return entries;
}

function readString(buf: Uint8Array, offset: number, length: number, dec: TextDecoder): string {
  const slice = buf.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return dec.decode(nul === -1 ? slice : slice.subarray(0, nul));
}

function readOctal(buf: Uint8Array, offset: number, length: number): number {
  const str = readString(buf, offset, length, new TextDecoder()).trim();
  return str === '' ? 0 : parseInt(str, 8);
}
