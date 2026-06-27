/**
 * `cloudtrik-hub logout`
 *
 * Clear the stored auth token. Best-effort POST to the registry to invalidate
 * server-side state; local clear always succeeds.
 *
 * Exit codes:
 *   0 = logged out (local clear succeeded)
 *   1 = config write fail
 */

import type { Command } from 'commander';
import { resolveRegistry } from '../registry/discovery.js';
import { ApiRoutes } from '../registry/routes.js';
import { postJson } from '../registry/client.js';
import { readConfig, clearToken } from '../auth/config.js';
import { info, warn } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
  registry?: string;
}

export function cmdLogout(program: Command): void {
  program
    .command('logout')
    .description('Clear the stored auth token')
    .action(async (_opts, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const cfg = await readConfig();
      if (cfg.token) {
        try {
          const resolved = await resolveRegistry({
            site: globalOpts.site,
            registry: globalOpts.registry,
            cachedRegistry: cfg.registry,
          });
          await postJson(resolved.apiBase, ApiRoutes.cliLogout, {}, cfg.token);
        } catch (err) {
          warn(`Server logout best-effort failed: ${(err as Error).message}`);
        }
      }
      await clearToken();
      info('Logged out');
    });
}
