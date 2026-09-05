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
import { DEFAULT_SITE } from '../registry/discovery.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
}

/**
 * Resolve the site URL used to start the browser login flow.
 *
 * Precedence: --site flag → CLOUDTRIK_HUB_SITE → DEFAULT_SITE.
 *
 * Exported so the default is directly assertable in a unit test. The 0.1.0
 * defect survived review precisely because this default was only reachable
 * through a five-minute interactive browser flow and so was never asserted.
 */
export function resolveLoginSite(site?: string): string {
  return site ?? process.env.CLOUDTRIK_HUB_SITE ?? DEFAULT_SITE;
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
      // Single source of truth: DEFAULT_SITE. A duplicated literal here is what
      // left `login` pointed at the wrong origin while discovery was corrected.
      const site = resolveLoginSite(globalOpts.site);
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
