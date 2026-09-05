/**
 * Structural guards over the shipped source tree.
 *
 * These are deliberately mechanical. The 0.1.0 defects were both of a kind
 * that per-line review missed: a THIRD copy of a wrong origin literal in a
 * file nobody re-read, and a security default that read as reasonable in
 * isolation. A test that greps the tree cannot get bored.
 *
 * Matching is HOST-ANCHORED, not substring-based. A bare
 * `body.includes('https://cloudtrik.com')` has no host boundary: it cannot
 * tell the marketing origin apart from `hub.cloudtrik.com` or from a
 * lookalike such as `https://cloudtrik.com.example.net`, whose real host is
 * `example.net`. Anchoring on the scheme and on the end of the host label is
 * what makes the verdict mean what it says.
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { scanPluginPackage, resolveScannerFromPath } from '../../src/scanner/shim.js';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/**
 * A URL literal whose host is EXACTLY the marketing site — optionally `www.`,
 * never a subdomain, never a longer host that merely starts with it.
 *
 *   https://cloudtrik.com            -> match   (the 0.1.0 defect)
 *   https://www.cloudtrik.com/x      -> match
 *   https://hub.cloudtrik.com        -> no match (the corrected default)
 *   https://cloudtrik.com.other.net  -> no match (host is other.net)
 */
const MARKETING_ORIGIN = /https?:\/\/(?:www\.)?cloudtrik\.com(?![a-z0-9.-])/i;

/**
 * A URL literal naming ANY host in the cloudtrik.com family. Exactly one
 * module is allowed to contain one: the registry discovery module. A second
 * file naming an origin is how a duplicated default gets born.
 */
const ANY_CLOUDTRIK_ORIGIN = /https?:\/\/(?:[a-z0-9-]+\.)*cloudtrik\.com(?![a-z0-9.-])/i;

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
  it('the matchers themselves behave (test of the test)', () => {
    // The exact 0.1.0 login.ts line the guard exists to catch. Note the shape:
    // the origin is the tail of a `??` chain, NOT the right-hand side of an
    // assignment — an assignment-shaped pattern would have missed it, which is
    // precisely how the third copy survived.
    const zeroOneZeroLine =
      "      const site = globalOpts.site ?? process.env.CLOUDTRIK_HUB_SITE ?? 'https://cloudtrik.com';";
    expect(MARKETING_ORIGIN.test(zeroOneZeroLine)).toBe(true);
    expect(MARKETING_ORIGIN.test("const DEFAULT_SITE = 'https://cloudtrik.com';")).toBe(true);
    expect(MARKETING_ORIGIN.test('a "http://www.cloudtrik.com/path" b')).toBe(true);
    expect(MARKETING_ORIGIN.test('HTTPS://CLOUDTRIK.COM')).toBe(true);

    // …and does not fire on the corrected default, on a lookalike host, or on
    // a longer label.
    expect(MARKETING_ORIGIN.test("const x = 'https://hub.cloudtrik.com';")).toBe(false);
    expect(MARKETING_ORIGIN.test("const x = 'https://cloudtrik.com.example.net';")).toBe(false);
    expect(MARKETING_ORIGIN.test("const x = 'https://cloudtrik.community';")).toBe(false);

    // The family matcher is broader by design.
    expect(ANY_CLOUDTRIK_ORIGIN.test("'https://hub.cloudtrik.com'")).toBe(true);
    expect(ANY_CLOUDTRIK_ORIGIN.test("'https://cloudtrik.com'")).toBe(true);
    expect(ANY_CLOUDTRIK_ORIGIN.test("'https://example.com'")).toBe(false);
  });

  it('no source file names the marketing origin', async () => {
    const files = await collectSources(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      if (MARKETING_ORIGIN.test(await readFile(file, 'utf8'))) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only the discovery module names an origin at all', async () => {
    // Prevents the class of defect directly: a second file re-introducing its
    // own origin constant instead of importing DEFAULT_SITE.
    const files = await collectSources(SRC_ROOT);
    const allowed = join('registry', 'discovery.ts');
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (rel === allowed) continue;
      if (ANY_CLOUDTRIK_ORIGIN.test(await readFile(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the scanner gate has no fail-open default — asserted by behaviour, not by symbol', async () => {
    // A symbol check (`not.toContain('noopAdapter')`) is a tripwire only: a
    // rename would pass it silently. The binding assertion is behavioural and
    // is stated in full in tests/scanner/shim.test.ts ("NEGATIVE CONTROL");
    // it is repeated here so this guard is self-sufficient.
    const emptyPathDir = await mkdtemp(join(tmpdir(), 'guard-empty-path-'));
    const originalPath = process.env.PATH;
    const originalBin = process.env.CLOUDTRIK_HUB_SCANNER_BIN;
    try {
      delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
      process.env.PATH = emptyPathDir;
      expect(resolveScannerFromPath()).toBeNull();
      const report = await scanPluginPackage('/tmp/guard-target');
      expect(report.ok).toBe(false);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalBin !== undefined) process.env.CLOUDTRIK_HUB_SCANNER_BIN = originalBin;
      await rm(emptyPathDir, { recursive: true, force: true });
    }

    // Cheap tripwire on top of the behavioural assertion.
    const body = await readFile(join(SRC_ROOT, 'scanner', 'shim.ts'), 'utf8');
    expect(body).not.toContain('noopAdapter');
  });
});
