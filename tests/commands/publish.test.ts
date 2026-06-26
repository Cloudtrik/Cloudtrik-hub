import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { writeConfig } from '../../src/auth/config.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('commands/publish', () => {
  let tempDir: string;
  let skillDir: string;
  const REGISTRY = 'https://registry.test';
  const UPLOAD_ORIGIN = 'https://upload.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('publish-cfg-');
    skillDir = await makeTempDir('publish-skill-');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\nversion: 1.0.0\n---\n# My skill',
      'utf8',
    );
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
    await cleanupTempDir(skillDir);
  });

  it('throws when not authenticated', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        'publish',
        skillDir,
        '--slug',
        'my-skill',
        '--name',
        'My',
        '--version',
        '1.0.0',
      ]),
    ).rejects.toThrow(/No auth token|login first/);
  });

  it('throws on invalid semver', async () => {
    await writeConfig({ token: 'tok' });
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        'publish',
        skillDir,
        '--slug',
        'my-skill',
        '--name',
        'My',
        '--version',
        'not-a-version',
      ]),
    ).rejects.toThrow(/Invalid semver/);
  });

  it('throws when SKILL.md missing', async () => {
    await writeConfig({ token: 'tok' });
    const empty = await makeTempDir('empty-');
    try {
      const program = buildProgram();
      program.exitOverride();
      await expect(
        program.parseAsync([
          'node',
          'cli',
          '--registry',
          REGISTRY,
          'publish',
          empty,
          '--slug',
          'foo',
          '--name',
          'foo',
          '--version',
          '1.0.0',
        ]),
      ).rejects.toThrow(/SKILL\.md/);
    } finally {
      await cleanupTempDir(empty);
    }
  });

  it('publishes via upload-url + presigned PUT + finalize', async () => {
    await writeConfig({ token: 'tok' });
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    const uploadPool = agent.get(UPLOAD_ORIGIN);
    pool.intercept({ path: '/api/cli/upload-url', method: 'POST' }).reply(200, {
      uploadUrl: `${UPLOAD_ORIGIN}/upload/abc`,
      uploadId: 'upload-id-1',
    });
    uploadPool.intercept({ path: '/upload/abc', method: 'PUT' }).reply(200, '');
    pool.intercept({ path: '/api/cli/publish', method: 'POST' }).reply(200, { ok: true });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'cli',
      '--registry',
      REGISTRY,
      'publish',
      skillDir,
      '--slug',
      'my-skill',
      '--name',
      'My Skill',
      '--version',
      '1.0.0',
      '--changelog',
      'init',
    ]);
  });
});
