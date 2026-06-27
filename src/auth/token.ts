/**
 * Token-paste auth path: operator supplies a token via CLI flag or stdin,
 * the CLI stores it in the config file.
 */

import { writeConfig } from './config.js';
import { CliError } from '../util/errors.js';

/**
 * Persist a token to the config file. Returns the absolute path it was
 * written to (for the success message).
 */
export async function storeToken(token: string, label?: string): Promise<void> {
  const trimmed = token.trim();
  if (trimmed === '') {
    throw new CliError('Token is empty', 4);
  }
  await writeConfig({
    token: trimmed,
    lastLogin: Date.now(),
    ...(label ? { label } : {}),
  });
}
