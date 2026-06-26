import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveWorkdir, skillsDir, skillInstallPath } from '../../src/workdir/resolve.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';

describe('workdir/resolve', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir('cloudtrik-hub-workdir-');
    delete process.env.CLOUDTRIK_HUB_WORKDIR;
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_WORKDIR;
    await cleanupTempDir(tempDir);
  });

  it('--workdir flag wins', async () => {
    const result = await resolveWorkdir({ workdir: tempDir });
    expect(result.workdir).toBe(tempDir);
    expect(result.source).toBe('flag');
  });

  it('CLOUDTRIK_HUB_WORKDIR env wins when no flag', async () => {
    process.env.CLOUDTRIK_HUB_WORKDIR = tempDir;
    const result = await resolveWorkdir({});
    expect(result.workdir).toBe(tempDir);
    expect(result.source).toBe('env');
  });

  it('detects existing .cloudtrik-hub/lock.json in cwd', async () => {
    await mkdir(join(tempDir, '.cloudtrik-hub'), { recursive: true });
    await writeFile(join(tempDir, '.cloudtrik-hub', 'lock.json'), '{}', 'utf8');
    const result = await resolveWorkdir({ cwd: tempDir });
    expect(result.workdir).toBe(tempDir);
    expect(result.source).toBe('cwd-lock');
  });

  it('falls back to cwd when no other source matches', async () => {
    const result = await resolveWorkdir({ cwd: tempDir });
    // Either 'cloudtrik-home' (if ~/.cloudtrik happens to exist) or 'cwd'.
    expect(['cwd', 'cloudtrik-home']).toContain(result.source);
  });

  it('skillsDir composes default sub-directory', () => {
    expect(skillsDir('/root')).toBe('/root/skills');
    expect(skillsDir('/root', 'my-skills')).toBe('/root/my-skills');
  });

  it('skillInstallPath composes per-slug path', () => {
    expect(skillInstallPath('/root', 'foo')).toBe('/root/skills/foo');
    expect(skillInstallPath('/root', 'foo', 'plugins')).toBe('/root/plugins/foo');
  });
});
