import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';
import { readToken } from '../../src/auth/config.js';
import { resolveLoginSite } from '../../src/commands/login.js';
import { DEFAULT_SITE } from '../../src/registry/discovery.js';
import { join } from 'node:path';

describe('commands/login', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('login-cfg-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
  });

  it('stores token via --token path', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', 'login', '--token', 'paste-token-xyz']);
    expect(await readToken()).toBe('paste-token-xyz');
  });

  it('stores token + label', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'cli', 'login', '--token', 'tok', '--label', 'my-cli']);
    expect(await readToken()).toBe('tok');
  });

  it('throws when --no-browser supplied without --token', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(program.parseAsync(['node', 'cli', 'login', '--no-browser'])).rejects.toThrow(
      /no --token|--token/,
    );
  });

  it('browser flow defaults to DEFAULT_SITE, never the marketing origin', () => {
    // Regression guard: in 0.1.0 this default was a third, duplicated literal
    // pointing at the marketing site, so `cloudtrik-hub login` stayed broken
    // out of the box even after registry discovery had been corrected.
    delete process.env.CLOUDTRIK_HUB_SITE;
    expect(resolveLoginSite()).toBe(DEFAULT_SITE);
    expect(resolveLoginSite()).not.toBe('https://cloudtrik.com');
  });

  it('browser flow honours --site then CLOUDTRIK_HUB_SITE', () => {
    process.env.CLOUDTRIK_HUB_SITE = 'https://env.example';
    expect(resolveLoginSite()).toBe('https://env.example');
    expect(resolveLoginSite('https://flag.example')).toBe('https://flag.example');
    delete process.env.CLOUDTRIK_HUB_SITE;
  });
});
