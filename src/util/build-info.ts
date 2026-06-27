/**
 * Build-time and runtime build/version information for the CLI.
 *
 * The CLI version is read at runtime from the installed package's package.json
 * (resolved via the dist/ output path), not embedded at build time. This keeps
 * the version field as the single source of truth and avoids the "forgot to bump
 * the embedded constant" bug class.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let cachedVersion: string | null = null;

/**
 * Returns the CLI semver string from the installed package.json.
 * Caches the result for subsequent calls within the same process.
 */
export function getCliVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    // From dist/util/build-info.js → up two levels to package root.
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/**
 * Returns the CLI name. Currently constant; future versions may read from
 * package.json#name for the bin alias.
 */
export function getCliName(): string {
  return 'cloudtrik-hub';
}
