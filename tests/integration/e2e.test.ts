import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildProgram } from '../../src/cli.js';
import { getTestMockAgent, makeTempDir, cleanupTempDir } from '../setup.js';
import { packDirectory } from '../../src/util/tar.js';
import { SCANNER_COMMAND } from '../../src/scanner/shim.js';
import { mkdir, writeFile, stat, chmod } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/**
 * Integration round-trip: search → install → list → whoami via MockAgent.
 *
 * This test exercises the full CLI pipe end-to-end with NO live network calls.
 * Every HTTP interaction is served by undici's MockAgent. The test thus proves:
 *   - The CLI tree composes cleanly across subcommands
 *   - State (lock.json + config.json) persists between commands within a session
 *   - The Pitfall-6 guard works (importing src/cli.ts didn't fire parseAsync)
 */
describe('integration/e2e round-trip', () => {
  let tempDir: string;
  let workdir: string;
  let scannerDir: string;
  let originalPath: string | undefined;
  const REGISTRY = 'https://registry.test';

  beforeEach(async () => {
    tempDir = await makeTempDir('e2e-cfg-');
    workdir = await makeTempDir('e2e-workdir-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');

    // Since 0.1.1 the install gate fails closed. Rather than injecting an
    // in-process adapter, this round-trip wires the scanner the way a real
    // environment does — an executable named `cloudtrik-skill-scan` on PATH —
    // so the discovery layer is exercised end-to-end and not merely mocked.
    scannerDir = await makeTempDir('e2e-scanner-');
    const stub = join(scannerDir, SCANNER_COMMAND);
    await writeFile(
      stub,
      `#!${process.execPath}\nconsole.log('{"findings":[],"criticalCount":0,"ok":true,"toolErrors":[]}');\n`,
      'utf8',
    );
    await chmod(stub, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${scannerDir}${delimiter}${originalPath ?? ''}`;
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await cleanupTempDir(scannerDir);
    await cleanupTempDir(tempDir);
    await cleanupTempDir(workdir);
  });

  it('search → install → list → whoami via MockAgent', async () => {
    // Stage tarball for install.
    const src = await makeTempDir('e2e-src-');
    let tarball: Uint8Array;
    try {
      await mkdir(src, { recursive: true });
      await writeFile(join(src, 'SKILL.md'), '---\nname: e2e-skill\nversion: 1.0.0\n---\n', 'utf8');
      tarball = await packDirectory(src);
    } finally {
      await cleanupTempDir(src);
    }

    // Wire all MockAgent interceptors up-front.
    const agent = getTestMockAgent();
    const pool = agent.get(REGISTRY);
    pool.intercept({ path: '/api/search?q=e2e&limit=20', method: 'GET' }).reply(200, {
      results: [
        {
          slug: 'e2e-skill',
          ownerHandle: 'alice',
          displayName: 'E2E Skill',
          summary: 'End-to-end fixture',
          score: 1.0,
          version: '1.0.0',
          updatedAt: Date.now(),
        },
      ],
    });
    pool
      .intercept({ path: '/api/v1/skills/e2e-skill/file', method: 'GET' })
      .reply(200, Buffer.from(tarball));
    pool
      .intercept({ path: '/api/cli/whoami', method: 'GET' })
      .reply(200, { handle: 'alice', displayName: 'Alice' });

    // Step 1: login --token (so whoami can succeed)
    {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        '--workdir',
        workdir,
        'login',
        '--token',
        'e2e-token',
      ]);
    }

    // Step 2: search "e2e"
    {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        '--workdir',
        workdir,
        'search',
        'e2e',
      ]);
    }

    // Step 3: install e2e-skill
    {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        '--workdir',
        workdir,
        'install',
        'e2e-skill',
      ]);
    }

    // Step 4: list — should show the installed skill
    const stdoutWrites: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        '--workdir',
        workdir,
        'list',
      ]);
    } finally {
      process.stdout.write = original;
    }
    const listOut = stdoutWrites.join('');
    expect(listOut).toContain('e2e-skill');

    // Step 5: whoami
    {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync([
        'node',
        'cli',
        '--registry',
        REGISTRY,
        '--workdir',
        workdir,
        'whoami',
      ]);
    }

    // Sanity: lockfile + install directory both exist on disk.
    const installPath = join(workdir, 'skills', 'e2e-skill');
    const lockPath = join(workdir, '.cloudtrik-hub', 'lock.json');
    const installStat = await stat(installPath);
    const lockStat = await stat(lockPath);
    expect(installStat.isDirectory()).toBe(true);
    expect(lockStat.isFile()).toBe(true);
  });
});
