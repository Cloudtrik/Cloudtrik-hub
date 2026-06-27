import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getConfigPath,
  readConfig,
  writeConfig,
  readToken,
  clearToken,
} from '../../src/auth/config.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';

describe('auth/config', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('cloudtrik-hub-auth-cfg-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
  });

  it('honors CLOUDTRIK_HUB_CONFIG_PATH override', () => {
    expect(getConfigPath()).toBe(join(tempDir, 'config.json'));
  });

  it('readConfig returns empty object when file missing', async () => {
    const cfg = await readConfig();
    expect(cfg).toEqual({});
  });

  it('writeConfig + readConfig round-trip', async () => {
    await writeConfig({ token: 't', registry: 'https://r.example' });
    const cfg = await readConfig();
    expect(cfg.token).toBe('t');
    expect(cfg.registry).toBe('https://r.example');
  });

  it('writeConfig merges with existing config', async () => {
    await writeConfig({ token: 'a' });
    await writeConfig({ registry: 'https://r2.example' });
    const cfg = await readConfig();
    expect(cfg.token).toBe('a');
    expect(cfg.registry).toBe('https://r2.example');
  });

  it('writeConfig writes file with mode 0600 on POSIX', async () => {
    if (process.platform === 'win32') return;
    await writeConfig({ token: 'secret' });
    const s = await stat(join(tempDir, 'config.json'));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('readToken returns undefined when no token', async () => {
    const tok = await readToken();
    expect(tok).toBeUndefined();
  });

  it('clearToken removes token from config', async () => {
    await writeConfig({ token: 't', registry: 'https://r.example' });
    await clearToken();
    const cfg = await readConfig();
    expect(cfg.token).toBeUndefined();
    expect(cfg.registry).toBe('https://r.example');
  });

  it('readConfig tolerates malformed JSON', async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, 'config.json'), '{ not json', 'utf8');
    const cfg = await readConfig();
    expect(cfg).toEqual({});
  });

  it('atomic write does not leave .tmp residue in success case', async () => {
    await writeConfig({ token: 'x' });
    // After atomic rename, no .tmp file should remain.
    const { readdir } = await import('node:fs/promises');
    const items = await readdir(tempDir);
    const tmpFiles = items.filter((n) => n.endsWith('.tmp') || n.includes('.tmp-'));
    expect(tmpFiles).toEqual([]);
  });
});
