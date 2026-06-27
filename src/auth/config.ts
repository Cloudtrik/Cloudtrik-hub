/**
 * Auth config file: read/write `~/.config/cloudtrik-hub/config.json`
 * (or XDG-compliant equivalent; override via `CLOUDTRIK_HUB_CONFIG_PATH`).
 *
 * The config file is written with mode 0600 to prevent other users on the
 * system from reading the stored token. We deliberately store the token as
 * plain JSON rather than e.g. keytar so the file is portable across
 * environments and CI runners.
 */

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AuthConfig {
  token?: string;
  registry?: string;
  lastLogin?: number;
  label?: string;
}

/**
 * Compute the absolute path to the config file.
 *
 * Precedence:
 *   1. CLOUDTRIK_HUB_CONFIG_PATH env var
 *   2. XDG_CONFIG_HOME/cloudtrik-hub/config.json
 *   3. ~/.config/cloudtrik-hub/config.json (Linux/macOS default)
 */
export function getConfigPath(): string {
  const explicit = process.env.CLOUDTRIK_HUB_CONFIG_PATH;
  if (explicit && explicit.trim() !== '') return explicit;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : join(homedir(), '.config');
  return join(base, 'cloudtrik-hub', 'config.json');
}

/**
 * Read the current config. Returns an empty object if no config file exists,
 * or if the file is unreadable / not valid JSON.
 */
export async function readConfig(): Promise<AuthConfig> {
  const path = getConfigPath();
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as AuthConfig;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Atomically write the merged config back to disk with mode 0600.
 * Merges the partial update over the existing config (callers don't need
 * to read-modify-write themselves).
 */
export async function writeConfig(update: Partial<AuthConfig>): Promise<void> {
  const path = getConfigPath();
  const existing = await readConfig();
  const merged: AuthConfig = { ...existing, ...update };
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(merged, null, 2), { encoding: 'utf8' });
  try {
    await chmod(tmpPath, 0o600);
  } catch {
    // Some filesystems (e.g. Windows) don't support chmod; tolerate.
  }
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, path);
}

/**
 * Convenience: read just the token (or undefined if no token stored).
 */
export async function readToken(): Promise<string | undefined> {
  const cfg = await readConfig();
  return cfg.token;
}

/**
 * Convenience: clear the stored token (writes config back without `token`).
 */
export async function clearToken(): Promise<void> {
  const existing = await readConfig();
  const next: AuthConfig = { ...existing };
  delete next.token;
  delete next.lastLogin;
  delete next.label;
  await writeConfigFull(next);
}

async function writeConfigFull(cfg: AuthConfig): Promise<void> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(cfg, null, 2), { encoding: 'utf8' });
  try {
    await chmod(tmpPath, 0o600);
  } catch {
    // Tolerate non-POSIX filesystems.
  }
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, path);
}
