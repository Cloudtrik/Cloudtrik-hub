import { describe, it, expect, afterEach } from 'vitest';
import {
  scanPluginPackage,
  setScannerAdapter,
  getScannerAdapter,
  formatScannerRejection,
  resolveScannerFromPath,
  SCANNER_COMMAND,
  type ScanReport,
} from '../../src/scanner/shim.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';
import { writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

const notWindows = process.platform !== 'win32';

/**
 * Write an executable stub named `cloudtrik-skill-scan` into `dir` that emits
 * the supplied ScanReport-shaped JSON on stdout.
 *
 * The shebang is an ABSOLUTE node path on purpose: these tests run with PATH
 * emptied, so a `#!/bin/sh` stub calling `cat` would fail to resolve `cat` and
 * fail closed — producing a green "rejects" assertion for entirely the wrong
 * reason.
 */
async function writeScannerStub(dir: string, json: string): Promise<string> {
  const stub = join(dir, SCANNER_COMMAND);
  await writeFile(stub, `#!${process.execPath}\nconsole.log(${JSON.stringify(json)});\n`, 'utf8');
  await chmod(stub, 0o755);
  return stub;
}

describe('scanner/shim', () => {
  afterEach(() => {
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
  });

  it('NEGATIVE CONTROL: fails closed with no adapter, no env var and no scanner on PATH', async () => {
    // The whole point of 0.1.1. In 0.1.0 this exact state returned ok:true
    // with zero findings — every skill declared safe WITHOUT BEING READ.
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
    const emptyPathDir = await makeTempDir('scanner-empty-path-');
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = emptyPathDir;
      expect(resolveScannerFromPath()).toBeNull();
      const report = await scanPluginPackage('/tmp/x');
      expect(report.ok).toBe(false);
      expect(report.target).toBe('/tmp/x');
      expect(report.toolErrors.length).toBeGreaterThan(0);
      expect(report.toolErrors[0]?.error).toMatch(/NOT scanned/);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await cleanupTempDir(emptyPathDir);
    }
  });

  it('NEGATIVE CONTROL: an unset PATH cannot yield a pass either', async () => {
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
    const originalPath = process.env.PATH;
    try {
      delete process.env.PATH;
      expect(resolveScannerFromPath()).toBeNull();
      const report = await scanPluginPackage('/tmp/x');
      expect(report.ok).toBe(false);
    } finally {
      if (originalPath !== undefined) process.env.PATH = originalPath;
    }
  });

  it.skipIf(!notWindows)(
    'POSITIVE CONTROL: uses a cloudtrik-skill-scan executable found on PATH',
    async () => {
      setScannerAdapter(null);
      delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
      const binDir = await makeTempDir('scanner-path-');
      const originalPath = process.env.PATH;
      try {
        await writeScannerStub(
          binDir,
          '{"findings":[],"criticalCount":0,"ok":true,"toolErrors":[]}',
        );
        process.env.PATH = binDir;
        expect(resolveScannerFromPath()).toBe(join(binDir, SCANNER_COMMAND));
        const report = await scanPluginPackage('/tmp/pkg');
        expect(report.ok).toBe(true);
        expect(report.target).toBe('/tmp/pkg');
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        await cleanupTempDir(binDir);
      }
    },
  );

  it.skipIf(!notWindows)('a PATH-discovered scanner can REJECT a package', async () => {
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
    const binDir = await makeTempDir('scanner-path-reject-');
    const originalPath = process.env.PATH;
    try {
      await writeScannerStub(
        binDir,
        '{"findings":[{"tool":"gitleaks","severity":"critical","rule":"key","message":"leak"}],"criticalCount":1,"ok":false,"toolErrors":[]}',
      );
      process.env.PATH = binDir;
      const report = await scanPluginPackage('/tmp/pkg');
      expect(report.ok).toBe(false);
      expect(report.criticalCount).toBe(1);
      // Distinguish a REAL scanner verdict from a fail-closed synthetic one:
      // the synthetic report carries no findings and one toolError.
      expect(report.findings.length).toBe(1);
      expect(report.toolErrors.length).toBe(0);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await cleanupTempDir(binDir);
    }
  });

  it.skipIf(!notWindows)('ignores relative and empty PATH entries', async () => {
    // A '.' or '' PATH entry must never make the working directory a scanner
    // source — that would be a trivially hijackable security control.
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
    const cwdDir = await makeTempDir('scanner-cwd-');
    const originalPath = process.env.PATH;
    const originalCwd = process.cwd();
    try {
      await writeScannerStub(cwdDir, '{"findings":[],"criticalCount":0,"ok":true,"toolErrors":[]}');
      process.chdir(cwdDir);
      process.env.PATH = `:.:${'relative/dir'}`;
      expect(resolveScannerFromPath()).toBeNull();
      const report = await scanPluginPackage('/tmp/x');
      expect(report.ok).toBe(false);
    } finally {
      process.chdir(originalCwd);
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await cleanupTempDir(cwdDir);
    }
  });

  it('honors injected adapter over default', async () => {
    setScannerAdapter({
      scan: async (target) => ({
        target,
        findings: [{ tool: 'gitleaks', severity: 'critical', rule: 'leaked-key', message: 'k' }],
        criticalCount: 1,
        ok: false,
        durationMs: 1,
        toolErrors: [],
      }),
    });
    const report = await scanPluginPackage('/tmp/y');
    expect(report.ok).toBe(false);
    expect(report.findings.length).toBe(1);
  });

  it('getScannerAdapter reflects injection state', () => {
    expect(getScannerAdapter()).toBeNull();
    const adapter = {
      scan: async (target: string): Promise<ScanReport> => ({
        target,
        findings: [],
        criticalCount: 0,
        ok: true,
        durationMs: 0,
        toolErrors: [],
      }),
    };
    setScannerAdapter(adapter);
    expect(getScannerAdapter()).toBe(adapter);
  });

  it.skipIf(!notWindows)(
    'spawns external scanner binary when env var set + adapter unset',
    async () => {
      const binDir = await makeTempDir('scanner-env-');
      try {
        const stub = await writeScannerStub(
          binDir,
          '{"findings":[],"criticalCount":0,"ok":true,"toolErrors":[]}',
        );
        setScannerAdapter(null);
        process.env.CLOUDTRIK_HUB_SCANNER_BIN = stub;
        const report = await scanPluginPackage('/tmp/env-target');
        expect(report.ok).toBe(true);
        expect(report.target).toBe('/tmp/env-target');
      } finally {
        delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
        await cleanupTempDir(binDir);
      }
    },
  );

  it('the injected adapter takes precedence over the env var', async () => {
    process.env.CLOUDTRIK_HUB_SCANNER_BIN = '/bin/echo'; // would fail closed
    setScannerAdapter({
      scan: async (target) => ({
        target,
        findings: [],
        criticalCount: 0,
        ok: true,
        durationMs: 0,
        toolErrors: [],
      }),
    });
    const report = await scanPluginPackage('z');
    expect(report.ok).toBe(true);
    setScannerAdapter(null);
    delete process.env.CLOUDTRIK_HUB_SCANNER_BIN;
  });

  it('fails closed when external binary returns non-JSON output', async () => {
    process.env.CLOUDTRIK_HUB_SCANNER_BIN = '/bin/echo';
    setScannerAdapter(null);
    const report = await scanPluginPackage('/tmp/scan-target');
    expect(report.ok).toBe(false);
    expect(report.criticalCount).toBeGreaterThan(0);
    expect(report.toolErrors.length).toBeGreaterThan(0);
  });

  it('formatScannerRejection produces a multi-line message', () => {
    const report: ScanReport = {
      target: '/tmp/p',
      findings: [{ tool: 'gitleaks', severity: 'critical', rule: 'aws-key', message: 'sk-...' }],
      criticalCount: 1,
      ok: false,
      durationMs: 12,
      toolErrors: [],
    };
    const msg = formatScannerRejection(report);
    expect(msg).toContain('REJECTED');
    expect(msg).toContain('critical');
    expect(msg).toContain('gitleaks');
  });
});
