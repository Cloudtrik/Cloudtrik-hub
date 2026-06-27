/**
 * Registry HTTP client.
 *
 * Thin undici wrapper that:
 *   - composes URLs against the resolved registry origin
 *   - injects Authorization bearer headers when a token is supplied
 *   - parses JSON responses
 *   - throws typed CliError on non-2xx with a friendly message
 *
 * Tests inject responses via undici's `MockAgent` (set globally via
 * `setGlobalDispatcher`). The client never makes outbound network calls in
 * a vitest run by default.
 */

import { request, type Dispatcher } from 'undici';
import { CliError } from '../util/errors.js';

export interface ClientRequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path under the registry origin (e.g. `/api/search?q=foo`). */
  path: string;
  /** Optional bearer token; injected as `Authorization: Bearer <token>`. */
  token?: string;
  /** Optional JSON body (object); serialized + Content-Type set. */
  json?: unknown;
  /** Optional raw body (e.g. for presigned PUTs); content type required. */
  body?: Uint8Array | Buffer | string;
  /** Optional Content-Type for raw body (defaults to application/octet-stream). */
  contentType?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

export interface ClientResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Dispatcher.ResponseData['body'];
}

/**
 * Execute a single HTTP request against the resolved registry origin.
 *
 * Throws CliError on:
 *   - Network/abort/timeout errors (exitCode=1; "registry unreachable")
 * The caller decides how to react to non-2xx by inspecting statusCode.
 */
export async function registryRequest(
  origin: string,
  opts: ClientRequestOpts,
): Promise<ClientResponse> {
  const method = opts.method ?? 'GET';
  const url = new URL(opts.path, origin);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;

  let body: Uint8Array | Buffer | string | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.body !== undefined) {
    headers['content-type'] = opts.contentType ?? 'application/octet-stream';
    body = opts.body;
  }

  try {
    const res = await request(url, { method, headers, body });
    return {
      statusCode: res.statusCode,
      headers: res.headers as Record<string, string | string[] | undefined>,
      body: res.body,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CliError(`Registry request failed: ${reason}`, 1);
  }
}

/**
 * Convenience helper: GET → parse JSON → return as unknown. Caller validates
 * with arktype.
 */
export async function getJson(
  origin: string,
  path: string,
  token?: string,
): Promise<{ statusCode: number; data: unknown }> {
  const res = await registryRequest(origin, { method: 'GET', path, token });
  if (res.statusCode === 204) {
    return { statusCode: res.statusCode, data: null };
  }
  try {
    const data = await res.body.json();
    return { statusCode: res.statusCode, data };
  } catch {
    // Non-JSON response. For non-2xx, let the caller surface the status code
    // and produce a status-appropriate error. For 2xx, this is genuinely
    // unexpected — throw so the caller sees the contract violation.
    try {
      await res.body.dump();
    } catch {
      // body already consumed
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      throw new CliError(`Registry returned non-JSON response (status ${res.statusCode})`, 1);
    }
    return { statusCode: res.statusCode, data: null };
  }
}

/**
 * POST a JSON body and return the parsed response.
 */
export async function postJson(
  origin: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ statusCode: number; data: unknown }> {
  const res = await registryRequest(origin, { method: 'POST', path, token, json: body });
  if (res.statusCode === 204) {
    return { statusCode: res.statusCode, data: null };
  }
  try {
    const data = await res.body.json();
    return { statusCode: res.statusCode, data };
  } catch {
    await res.body.dump();
    return { statusCode: res.statusCode, data: null };
  }
}

/**
 * Download a binary payload (tarball). Throws on non-2xx.
 */
export async function getBytes(origin: string, path: string, token?: string): Promise<Uint8Array> {
  const res = await registryRequest(origin, { method: 'GET', path, token });
  if (res.statusCode !== 200) {
    await res.body.dump();
    throw new CliError(`Download failed: HTTP ${res.statusCode}`, 1);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of res.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}
