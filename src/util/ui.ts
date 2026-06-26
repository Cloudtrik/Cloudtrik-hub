/**
 * UI helpers: console output formatting + spinner factory.
 *
 * Wraps `ora` for spinners. Console output uses plain functions so tests can
 * intercept stdout/stderr without mocking a logger framework.
 */

import ora, { type Ora } from 'ora';

let quietMode = false;

/**
 * Enable quiet mode for the current process. When quiet, info() calls are
 * suppressed but warn() and error() still emit.
 */
export function setQuietMode(quiet: boolean): void {
  quietMode = quiet;
}

export function info(message: string): void {
  if (!quietMode) {
    process.stdout.write(`${message}\n`);
  }
}

export function warn(message: string): void {
  process.stderr.write(`warn: ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`error: ${message}\n`);
}

/**
 * Start a labeled spinner. Returns the underlying `ora` instance.
 * In quiet mode or non-TTY environments, falls back to silent operation.
 */
export function startSpinner(text: string): Ora {
  const spinner = ora({
    text,
    isSilent: quietMode,
    discardStdin: false,
  });
  return spinner.start();
}
