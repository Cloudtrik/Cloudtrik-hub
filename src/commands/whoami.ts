/**
 * `cloudtrik-hub whoami`
 *
 * Print the authenticated user's handle.
 *
 * HTTP: GET /api/cli/whoami (Authorization: Bearer <token>)
 * Auth: REQUIRED
 *
 * Exit codes:
 *   0 = identity returned
 *   1 = no token (run `login` first)
 *   2 = HTTP error
 */

import type { Command } from 'commander';
import { type } from 'arktype';
import { ApiRoutes } from '../registry/routes.js';
import { resolveRegistry } from '../registry/discovery.js';
import { getJson } from '../registry/client.js';
import { WhoamiResponseSchema } from '../registry/types.js';
import { readConfig } from '../auth/config.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
  registry?: string;
}

export function cmdWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Print the authenticated user identity')
    .action(async (_opts, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const cfg = await readConfig();
      if (!cfg.token) {
        throw new CliError('No auth token. Run `cloudtrik-hub login` first.', 1);
      }
      const resolved = await resolveRegistry({
        site: globalOpts.site,
        registry: globalOpts.registry,
        cachedRegistry: cfg.registry,
      });
      const res = await getJson(resolved.apiBase, ApiRoutes.cliWhoami, cfg.token);
      if (res.statusCode !== 200) {
        throw new CliError(`whoami failed: HTTP ${res.statusCode}`, 2);
      }
      const parsed = WhoamiResponseSchema(res.data);
      if (parsed instanceof type.errors) {
        throw new CliError('Registry returned unexpected whoami shape', 2);
      }
      info(parsed.handle);
      if (parsed.displayName) info(`  ${parsed.displayName}`);
    });
}
