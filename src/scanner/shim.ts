/**
 * Install-time security gate shim.
 *
 * This module defines the public interface for the install-time scanner gate.
 * The `install` and `update` commands call `scanPluginPackage(target)` BEFORE
 * moving a downloaded tarball into the destination directory. If the scan
 * report is `ok: false`, install is aborted and the temp directory is cleaned up.
 *
 * FAIL-CLOSED CONTRACT (since 0.1.1)
 * ---------------------------------
 * When no scanner can be resolved, the gate REFUSES: it returns
 * `ok: false` with a toolError explaining how to configure one. It never
 * returns `ok: true` without a scanner having actually run.
 *
 * Prior to 0.1.1 the default was a no-op-PASS adapter, so an install performed
 * with no scanner configured reported every package as safe WITHOUT READING IT.
 * That is a security control that silently disables itself, and it is the
 * defect this contract replaces. There is deliberately no opt-out: an escape
 * hatch would restore exactly the behaviour being removed.
 *
 * Resolution order:
 *
 *   1. Programmatic injection (preferred for embedders + tests):
 *        import { setScannerAdapter } from 'cloudtrik-hub/scanner/shim';
 *        setScannerAdapter({ scan: async (target) => doRealScan(target) });
 *
 *   2. External binary named by CLOUDTRIK_HUB_SCANNER_BIN:
 *        export CLOUDTRIK_HUB_SCANNER_BIN=/opt/scanners/my-scanner
 *      The CLI spawns that binary with the target path as argv[1] and expects
 *      a `ScanReport` JSON object on stdout.
 *
 *   3. A `cloudtrik-skill-scan` executable discovered on PATH. This is the
 *      companion-tool convention (cf. `git` finding `git-lfs`): environments
 *      that ship a scanner put it on PATH once, and every execution context —
 *      login shell, `sudo -u`, cron, service unit — resolves it without each
 *      one needing its own environment wiring. An environment variable set in
 *      a single service unit reaches only that unit's children, which is how
 *      the control came to be absent everywhere else.
 *
 *   4. Otherwise: FAIL CLOSED.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

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

/**
 * Conventional name of the companion scanner executable looked up on PATH.
 *
 * Exported so that packagers, tests and negative controls reference one
 * constant rather than re-typing the string.
 */
export const SCANNER_COMMAND = 'cloudtrik-skill-scan';

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
 * Locate the companion scanner executable on PATH.
 *
 * Deliberately stricter than a bare `spawn('cloudtrik-skill-scan')`:
 *   - empty and relative PATH entries are skipped, so a '.' or '' entry can
 *     never make the current working directory a scanner source;
 *   - the candidate must be a regular file (symlinks are followed, so the
 *     usual `/usr/local/bin/x -> /opt/product/bin/x` wiring works) and must be
 *     executable by this process.
 *
 * Returns the absolute path, or null when no such executable exists.
 */
export function resolveScannerFromPath(command: string = SCANNER_COMMAND): string | null {
  const rawPath = process.env.PATH;
  if (!rawPath) return null;
  for (const entry of rawPath.split(delimiter)) {
    if (entry === '' || !isAbsolute(entry)) continue;
    const candidate = join(entry, command);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Run the install-time security scanner against the given target path.
 *
 * Resolution order:
 *   1. Programmatically-injected adapter (via setScannerAdapter)
 *   2. External binary at $CLOUDTRIK_HUB_SCANNER_BIN
 *   3. `cloudtrik-skill-scan` discovered on PATH
 *   4. FAIL CLOSED — ok:false, with a toolError saying how to configure one
 *
 * The install/update commands call this BEFORE moving the tarball into the
 * destination directory. They MUST honor `report.ok === false` by aborting
 * the install and cleaning up any partially-extracted artifacts.
 *
 * There is no code path through this function that returns `ok: true` without
 * a scanner having produced that verdict.
 */
export async function scanPluginPackage(target: string): Promise<ScanReport> {
  if (injectedAdapter) {
    return injectedAdapter.scan(target);
  }

  const bin = process.env.CLOUDTRIK_HUB_SCANNER_BIN;
  if (bin && bin.trim() !== '') {
    return runExternalScanner(bin.trim(), target);
  }

  const discovered = resolveScannerFromPath();
  if (discovered) {
    return runExternalScanner(discovered, target);
  }

  return unconfiguredFailClosed(target);
}

/**
 * The fail-closed verdict returned when no scanner could be resolved.
 *
 * `ok: false` is the contract the install/update commands act on; the
 * toolError carries the remediation so the refusal is actionable rather than
 * merely obstructive.
 */
function unconfiguredFailClosed(target: string): ScanReport {
  return {
    target,
    findings: [],
    criticalCount: 0,
    ok: false,
    durationMs: 0,
    toolErrors: [
      {
        tool: SCANNER_COMMAND,
        error:
          'no install-time scanner is available, so this package was NOT scanned. ' +
          `Install a scanner as '${SCANNER_COMMAND}' on PATH, or set ` +
          'CLOUDTRIK_HUB_SCANNER_BIN to an executable that emits a ScanReport JSON object on stdout.',
      },
    ],
  };
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
