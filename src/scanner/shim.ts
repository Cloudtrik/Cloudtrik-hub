/**
 * Install-time security gate shim.
 *
 * This module defines the public interface for the install-time scanner gate.
 * The `install` and `update` commands call `scanPluginPackage(target)` BEFORE
 * moving a downloaded tarball into the destination directory. If the scan
 * report is `ok: false`, install is aborted and the temp directory is cleaned up.
 *
 * The default adapter is a no-op-PASS: scanning succeeds with zero findings.
 * This keeps the install path functional in environments without a real
 * scanner toolchain.
 *
 * Operators in environments that ship a real scanner toolchain can inject a
 * real adapter in one of two ways:
 *
 *   1. Programmatic injection (preferred for embedders + tests):
 *        import { setScannerAdapter } from 'cloudtrik-hub/scanner/shim';
 *        setScannerAdapter({ scan: async (target) => doRealScan(target) });
 *
 *   2. External binary injection (preferred for runtime environments):
 *        export CLOUDTRIK_HUB_SCANNER_BIN=/usr/local/bin/my-scanner
 *      The CLI spawns that binary with the target path as argv[1] and expects
 *      a `ScanReport` JSON object on stdout.
 *
 * A future companion package may publish a real scanner adapter on npm. Until
 * that lands, the env-var injection point is the supported integration
 * mechanism.
 */

import { spawn } from 'node:child_process';

export type Severity = 'info' | 'warning' | 'critical';

export type ScannerTool = 'semgrep' | 'osv-scanner' | 'gitleaks' | 'trivy' | string;

export interface ScannerFinding {
  tool: ScannerTool;
  severity: Severity;
  rule: string;
  file?: string;
  line?: number;
  message: string;
}

export interface ScanReport {
  target: string;
  findings: ScannerFinding[];
  criticalCount: number;
  ok: boolean;
  durationMs: number;
  toolErrors: Array<{ tool: ScannerTool; error: string }>;
}

export interface ScannerAdapter {
  scan(target: string): Promise<ScanReport>;
}

const noopAdapter: ScannerAdapter = {
  scan: async (target: string): Promise<ScanReport> => ({
    target,
    findings: [],
    criticalCount: 0,
    ok: true,
    durationMs: 0,
    toolErrors: [],
  }),
};

let injectedAdapter: ScannerAdapter | null = null;

/**
 * Inject a runtime scanner adapter. Subsequent calls to `scanPluginPackage`
 * will use this adapter instead of the default no-op or env-var binary.
 *
 * Pass `null` to clear the injection (useful for test teardown).
 */
export function setScannerAdapter(adapter: ScannerAdapter | null): void {
  injectedAdapter = adapter;
}

/**
 * Read the currently-injected adapter (for testing/inspection).
 */
export function getScannerAdapter(): ScannerAdapter | null {
  return injectedAdapter;
}

/**
 * Run the install-time security scanner against the given target path.
 *
 * Resolution order:
 *   1. Programmatically-injected adapter (via setScannerAdapter)
 *   2. External binary at $CLOUDTRIK_HUB_SCANNER_BIN
 *   3. No-op-PASS default
 *
 * The install/update commands call this BEFORE moving the tarball into the
 * destination directory. They MUST honor `report.ok === false` by aborting
 * the install and cleaning up any partially-extracted artifacts.
 */
export async function scanPluginPackage(target: string): Promise<ScanReport> {
  if (injectedAdapter) {
    return injectedAdapter.scan(target);
  }

  const bin = process.env.CLOUDTRIK_HUB_SCANNER_BIN;
  if (bin && bin.trim() !== '') {
    return runExternalScanner(bin, target);
  }

  return noopAdapter.scan(target);
}

/**
 * Spawn an external scanner binary, parse its stdout JSON, and return the
 * report. The binary is expected to write a single ScanReport JSON object
 * to stdout and exit with code 0 (regardless of whether `ok` is true/false).
 *
 * On parse failure or non-zero exit without JSON output, the function returns
 * a synthetic report with `ok: false` and a toolError describing the failure
 * — fail-closed when an explicit external scanner was configured but did not
 * produce a valid result.
 */
async function runExternalScanner(bin: string, target: string): Promise<ScanReport> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(bin, [target], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (err) => {
      resolve(failClosed(bin, target, start, `spawn error: ${err.message}`));
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      try {
        const parsed = JSON.parse(stdout) as Partial<ScanReport>;
        const report: ScanReport = {
          target,
          findings: parsed.findings ?? [],
          criticalCount: parsed.criticalCount ?? 0,
          ok: parsed.ok ?? code === 0,
          durationMs: Date.now() - start,
          toolErrors: parsed.toolErrors ?? [],
        };
        resolve(report);
      } catch (err) {
        const reason = err instanceof Error ? err.message : `non-zero exit ${code}, no JSON output`;
        resolve(failClosed(bin, target, start, reason));
      }
    });
  });
}

function failClosed(bin: string, target: string, start: number, reason: string): ScanReport {
  return {
    target,
    findings: [],
    criticalCount: 1,
    ok: false,
    durationMs: Date.now() - start,
    toolErrors: [{ tool: bin, error: reason }],
  };
}

/**
 * Format a human-readable rejection message from a failing scan report.
 *
 * Used by the install/update commands when the gate refuses a package.
 */
export function formatScannerRejection(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`Security gate REJECTED package ${report.target}`);
  if (report.criticalCount > 0) {
    lines.push(`  ${report.criticalCount} critical finding(s) reported`);
  }
  for (const finding of report.findings) {
    if (finding.severity === 'critical') {
      lines.push(`  [${finding.tool}] ${finding.rule}: ${finding.message}`);
    }
  }
  for (const toolError of report.toolErrors) {
    lines.push(`  scanner ${toolError.tool} error: ${toolError.error}`);
  }
  return lines.join('\n');
}
