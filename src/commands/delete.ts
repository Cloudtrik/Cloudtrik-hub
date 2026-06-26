/**
 * `cloudtrik-hub delete <slug> --yes`
 *
 * Delete a skill from the registry (owner/admin only).
 *
 * HTTP: DELETE /api/v1/skills/{slug} (preferred) OR POST /api/cli/skill/delete
 * Auth: REQUIRED
 *
 * Exit codes:
 *   0 = deleted
 *   1 = auth missing
 *   2 = HTTP 403 not owner
 *   3 = HTTP 404 not found
 *   4 = --yes not supplied
 */

import type { Command } from 'commander';
import { ApiRoutes } from '../registry/routes.js';
import { resolveRegistry } from '../registry/discovery.js';
import { registryRequest } from '../registry/client.js';
import { readConfig } from '../auth/config.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
  registry?: string;
}

export function cmdDelete(program: Command): void {
  program
    .command('delete')
    .description('Delete a skill from the registry (owner/admin only)')
    .argument('<slug>', 'Skill slug to delete')
    .option('--yes', 'Confirm deletion (required)', false)
    .action(async (slug: string, opts: { yes?: boolean }, cmd) => {
      if (!opts.yes) {
        throw new CliError('Pass --yes to confirm deletion', 4);
      }
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
      const res = await registryRequest(resolved.apiBase, {
        method: 'DELETE',
        path: ApiRoutes.skillDetail(slug),
        token: cfg.token,
      });
      const statusCode = res.statusCode;
      await res.body.dump();
      if (statusCode === 403) {
        throw new CliError(`Not authorized to delete ${slug}`, 2);
      }
      if (statusCode === 404) {
        throw new CliError(`${slug} not found`, 3);
      }
      if (statusCode < 200 || statusCode >= 300) {
        throw new CliError(`Delete failed: HTTP ${statusCode}`, 1);
      }
      info(`Deleted ${slug}`);
    });
}
