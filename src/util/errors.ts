/**
 * Typed CLI error class with an associated process exit code.
 *
 * Command handlers throw CliError when they want the CLI runner to:
 *   1. Print the error.message to stderr
 *   2. Exit the process with the embedded exit code
 *
 * This avoids `process.exit()` calls deep in command handlers (which break
 * programmatic embedding and test runners). The cli.ts top-level wraps every
 * subcommand invocation in a try/catch that handles CliError specifically.
 */
export class CliError extends Error {
  public readonly exitCode: number;
  public readonly hint: string | undefined;

  constructor(message: string, exitCode: number = 1, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

/**
 * Map a thrown value to a (message, exitCode) pair for the top-level handler.
 */
export function explainError(err: unknown): { message: string; exitCode: number; hint?: string } {
  if (err instanceof CliError) {
    return { message: err.message, exitCode: err.exitCode, hint: err.hint };
  }
  if (err instanceof Error) {
    return { message: err.message, exitCode: 1 };
  }
  return { message: String(err), exitCode: 1 };
}
