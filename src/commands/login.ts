/**
 * `cloudtrik-hub login [--token <token>] [--label <label>] [--no-browser]`
 *
 * Authenticate with the registry. Supports two flows:
 *   1. Token paste: --token <token> (writes immediately)
 *   2. Browser loopback: opens browser, listens on 127.0.0.1, waits for token
 *
 * Exit codes:
 *   0 = logged in
 *   1 = browser flow timeout (5 min)
 *   2 = bad redirect_uri (not loopback) — defensive
 *   3 = state mismatch (CSRF)
 *   4 = token validation failure
 */

import type { Command } from 'commander';
import { storeToken } from '../auth/token.js';
import { loginViaBrowser } from '../auth/browser.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
}

export function cmdLogin(program: Command): void {
  program
    .command('login')
    .description('Authenticate with the Cloudtrik registry')
    .option('--token <token>', 'Use a token directly (skips browser)')
    .option('--label <label>', 'Label to associate with the token', 'CLI token')
    .option('--no-browser', 'Disable browser flow (use --token instead)', false)
    .action(async (opts: { token?: string; label?: string; browser?: boolean }, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      if (opts.token) {
        await storeToken(opts.token, opts.label);
        info('Token stored');
        return;
      }
      if (opts.browser === false) {
        throw new CliError('--no-browser was set but no --token supplied; pass --token <value>', 4);
      }
      const site = globalOpts.site ?? process.env.CLOUDTRIK_HUB_SITE ?? 'https://cloudtrik.com';
      info(`Starting browser login (site: ${site})…`);
      await loginViaBrowser({
        siteUrl: site,
        ...(opts.label ? { label: opts.label } : {}),
        onUrl: (url) => {
          info(`Open this URL in your browser to complete login:\n  ${url}`);
        },
      });
      info('Login successful');
    });
}
