/**
 * Registry discovery indirection.
 *
 * The CLI ships with a sensible default registry origin but supports operator
 * override via:
 *   1. --registry CLI flag (explicit)
 *   2. CLOUDTRIK_HUB_REGISTRY env var
 *   3. /.well-known/cloudtrik-hub.json on the site URL (discovery)
 *   4. Cached value in the config file
 *   5. Fallback constant
 *
 * Discovery lets operators stand up a real registry later without forcing a
 * CLI release: a /.well-known JSON pointing at a new origin is enough.
 */

import { request } from 'undici';
import { type } from 'arktype';
import { ApiRoutes } from './routes.js';
import { WellKnownSchema } from './types.js';

export const DEFAULT_SITE = 'https://cloudtrik.com';
export const DEFAULT_REGISTRY = 'https://cloudtrik.com';

export interface ResolveRegistryOpts {
  /** Site URL (used for browser flow + discovery indirection). */
  site?: string;
  /** Explicit registry URL (highest priority when provided). */
  registry?: string;
  /** Cached registry from local config (lower priority than discovery). */
  cachedRegistry?: string;
}

export interface DiscoveryResult {
  apiBase: string;
  source: 'explicit' | 'env' | 'well-known' | 'cached' | 'default';
}

/**
 * Resolve the registry origin URL according to the documented precedence.
 *
 * The result includes which precedence layer produced it so the CLI can emit
 * an informative `--verbose` message about where the registry came from.
 */
export async function resolveRegistry(opts: ResolveRegistryOpts = {}): Promise<DiscoveryResult> {
  const explicit = opts.registry?.trim();
  if (explicit) return { apiBase: explicit, source: 'explicit' };

  const fromEnv = process.env.CLOUDTRIK_HUB_REGISTRY?.trim();
  if (fromEnv) return { apiBase: fromEnv, source: 'env' };

  const siteUrl = (opts.site ?? process.env.CLOUDTRIK_HUB_SITE ?? DEFAULT_SITE).trim();
  const discovered = await discoverFromSite(siteUrl);
  if (discovered) return { apiBase: discovered, source: 'well-known' };

  const cached = opts.cachedRegistry?.trim();
  if (cached) return { apiBase: cached, source: 'cached' };

  return { apiBase: DEFAULT_REGISTRY, source: 'default' };
}

/**
 * Probe the site URL for `/.well-known/cloudtrik-hub.json`.
 * Returns the apiBase string on success, or null when:
 *   - HTTP status != 200
 *   - Body is not valid JSON
 *   - Body does not match the WellKnown schema
 *   - Network error / timeout / abort
 *
 * NOTE: returning null is intentional — the caller continues to the next
 * resolution layer. Errors are not surfaced; they are observable to the user
 * via a verbose flag or via the eventual typed error from the next failing layer.
 */
export async function discoverFromSite(siteUrl: string): Promise<string | null> {
  try {
    const target = new URL(ApiRoutes.wellKnown, siteUrl);
    const res = await request(target, {
      method: 'GET',
      headersTimeout: 5000,
      bodyTimeout: 5000,
    });
    if (res.statusCode !== 200) {
      // Drain body to release the socket.
      await res.body.dump();
      return null;
    }
    const body = (await res.body.json()) as unknown;
    const parsed = WellKnownSchema(body);
    if (parsed instanceof type.errors) return null;
    return parsed.apiBase;
  } catch {
    return null;
  }
}

/**
 * Produce the canonical "registry not available" typed error message.
 * The CLI emits this when a command requires a live registry and none of the
 * resolution layers produced a working endpoint.
 */
export function registryUnavailableMessage(siteUrl: string): string {
  return (
    `Cloudtrik registry is not yet reachable at ${siteUrl}. ` +
    `The CLI is installed correctly but the registry service is offline or under ` +
    `construction. See https://github.com/Cloudtrik/Cloudtrik-hub for status updates.`
  );
}
