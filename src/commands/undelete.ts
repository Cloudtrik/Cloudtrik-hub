/**
 * `cloudtrik-hub undelete <slug> --yes`
 *
 * Restore a previously-deleted skill (owner/admin only).
 *
 * HTTP: POST /api/v1/skills/{slug}/undelete (preferred) OR /api/cli/skill/undelete
 * Auth: REQUIRED
 *
 * Exit codes:
 *   0 = restored
 *   1 = auth missing
 *   2 = HTTP 403 not owner
 *   3 = HTTP 404 not found
 *   4 = --yes not supplied
 */

import type { Command } from 'commander';
import { resolveRegistry } from '../registry/discovery.js';
import { registryRequest } from '../registry/client.js';
import { readConfig } from '../auth/config.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
  registry?: string;
}

export function cmdUndelete(program: Command): void {
  program
    .command('undelete')
    .description('Restore a previously-deleted skill (owner/admin only)')
    .argument('<slug>', 'Skill slug to restore')
    .option('--yes', 'Confirm restore (required)', false)
    .action(async (slug: string, opts: { yes?: boolean }, cmd) => {
      if (!opts.yes) {
        throw new CliError('Pass --yes to confirm restore', 4);
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
      const path = `/api/v1/skills/${encodeURIComponent(slug)}/undelete`;
      const res = await registryRequest(resolved.apiBase, {
        method: 'POST',
        path,
        token: cfg.token,
        json: {},
      });
      const statusCode = res.statusCode;
      await res.body.dump();
      if (statusCode === 403) {
        throw new CliError(`Not authorized to undelete ${slug}`, 2);
      }
      if (statusCode === 404) {
        throw new CliError(`${slug} not found`, 3);
      }
      if (statusCode < 200 || statusCode >= 300) {
        throw new CliError(`Undelete failed: HTTP ${statusCode}`, 1);
      }
      info(`Restored ${slug}`);
    });
}
