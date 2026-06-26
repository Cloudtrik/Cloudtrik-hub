/**
 * `cloudtrik-hub search <query> [--limit <n>]`
 *
 * Searches the registry for skills matching the query. Prints results one per
 * line as `slug (ownerHandle) — displayName` followed by a truncated summary.
 *
 * HTTP: GET /api/search?q=<query>&limit=<n>
 * Auth: optional
 * Exit codes: 0 (success), 1 (HTTP error), 2 (schema mismatch)
 */

import type { Command } from 'commander';
import { type } from 'arktype';
import { resolveRegistry, registryUnavailableMessage } from '../registry/discovery.js';
import { ApiRoutes } from '../registry/routes.js';
import { getJson } from '../registry/client.js';
import { SearchResultsSchema } from '../registry/types.js';
import { readConfig } from '../auth/config.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';

interface GlobalOpts {
  site?: string;
  registry?: string;
}

export function cmdSearch(program: Command): void {
  program
    .command('search')
    .description('Search the Cloudtrik registry for skills')
    .argument('<query>', 'Search query string')
    .option('--limit <n>', 'Maximum number of results', '20')
    .action(async (query: string, opts: { limit: string }, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const cfg = await readConfig();
      const resolved = await resolveRegistry({
        site: globalOpts.site,
        registry: globalOpts.registry,
        cachedRegistry: cfg.registry,
      });
      const url = new URL(ApiRoutes.search, resolved.apiBase);
      url.searchParams.set('q', query);
      const limitNum = parseInt(opts.limit, 10);
      if (!Number.isFinite(limitNum) || limitNum < 1) {
        throw new CliError(`Invalid --limit value: ${opts.limit}`, 1);
      }
      url.searchParams.set('limit', String(limitNum));

      const path = url.pathname + url.search;
      let response;
      try {
        response = await getJson(resolved.apiBase, path);
      } catch (err) {
        if (resolved.source === 'default') {
          throw new CliError(registryUnavailableMessage(globalOpts.site ?? resolved.apiBase), 1);
        }
        throw err;
      }
      if (response.statusCode === 404) {
        throw new CliError(registryUnavailableMessage(resolved.apiBase), 1);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new CliError(`Search failed: HTTP ${response.statusCode}`, 1);
      }

      const parsed = SearchResultsSchema(response.data);
      if (parsed instanceof type.errors) {
        throw new CliError(`Registry returned unexpected response shape: ${parsed.summary}`, 2);
      }

      if (parsed.results.length === 0) {
        info(`No results found for "${query}"`);
        return;
      }
      for (const result of parsed.results) {
        info(`${result.slug} (${result.ownerHandle}) — ${result.displayName}`);
        const summary =
          result.summary.length > 100 ? `${result.summary.slice(0, 100)}…` : result.summary;
        info(`  ${summary}`);
      }
    });
}
