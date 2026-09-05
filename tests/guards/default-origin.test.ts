/**
 * Structural guards over the shipped source tree.
 *
 * These are deliberately mechanical. The 0.1.0 defects were both of a kind
 * that per-line review missed: a THIRD copy of a wrong origin literal in a
 * file nobody re-read, and a security default that read as reasonable in
 * isolation. A test that greps the tree cannot get bored.
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** Recursively collect every .ts file under `dir`. */
async function collectSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSources(full)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('guards/source tree', () => {
  it('no source file references the marketing origin', async () => {
    // 'https://cloudtrik.com' is the marketing website; it serves no registry
    // routes. `https://hub.cloudtrik.com` does not contain this substring, so
    // the corrected default does not trip the guard.
    const files = await collectSources(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const body = await readFile(file, 'utf8');
      if (body.includes('https://cloudtrik.com')) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scanner shim declares no no-op-PASS default adapter', async () => {
    const body = await readFile(join(SRC_ROOT, 'scanner', 'shim.ts'), 'utf8');
    expect(body).not.toContain('noopAdapter');
  });

  it('only the discovery module declares a default origin literal', async () => {
    // Prevents the class of defect directly: a second file re-introducing its
    // own origin constant instead of importing DEFAULT_SITE.
    const files = await collectSources(SRC_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (rel === join('registry', 'discovery.ts')) continue;
      const body = await readFile(file, 'utf8');
      if (/=\s*'https:\/\/[a-z0-9.-]*cloudtrik\.com'/.test(body)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
