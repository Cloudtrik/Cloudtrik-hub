/**
 * Browser-loopback auth flow.
 *
 * The CLI starts an HTTP server on 127.0.0.1 with a random port, generates
 * a fresh CSRF state token, and prints a URL the user opens in their browser.
 * The browser flow on the site posts the bearer token back to the loopback
 * server (verifying state); the CLI persists the token via the config module
 * and exits with success.
 *
 * The 5-minute timeout prevents the CLI from blocking indefinitely if the
 * user abandons the flow.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeConfig } from './config.js';
import { CliError } from '../util/errors.js';

export interface BrowserLoginOpts {
  /** Site URL for the browser flow start (e.g. https://cloudtrik.com). */
  siteUrl: string;
  /** Override the bind port (otherwise random). Tests use a fixed port. */
  port?: number;
  /** Timeout in milliseconds (default 5 minutes). */
  timeoutMs?: number;
  /** Optional label to associate with the stored token. */
  label?: string;
  /** Callback invoked once the URL is composed (so the runner can open a browser). */
  onUrl?: (authUrl: string) => void;
}

export interface BrowserLoginResult {
  token: string;
  port: number;
}

/**
 * Run the browser auth flow. Resolves with the captured token on success.
 * Rejects with a CliError on timeout, state mismatch, or transport error.
 */
export async function loginViaBrowser(opts: BrowserLoginOpts): Promise<BrowserLoginResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const state = randomBytes(32).toString('hex');

  return new Promise<BrowserLoginResult>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const server = createServer((req, res) => {
      // The inbound handler returns a discriminated result so we never throw
      // out of the server callback. Any error inside the IIFE is reported via
      // `reject` (or swallowed if `settle` already fired), never re-thrown.
      void (async (): Promise<void> => {
        try {
          const result = await handleRequest(req, res, state);
          if (result.kind === 'noop') return;
          if (result.kind === 'error') {
            settle(() => server.close(() => reject(result.error)));
            return;
          }
          await writeConfig({
            token: result.token,
            lastLogin: Date.now(),
            ...(opts.label ? { label: opts.label } : {}),
          });
          settle(() =>
            server.close(() => {
              const addr = server.address();
              const port = typeof addr === 'object' && addr ? addr.port : 0;
              resolve({ token: result.token, port });
            }),
          );
        } catch (innerErr) {
          settle(() =>
            server.close(() =>
              reject(
                innerErr instanceof CliError
                  ? innerErr
                  : new CliError(`Browser login internal error: ${(innerErr as Error).message}`, 1),
              ),
            ),
          );
        }
      })().catch(() => {
        // The IIFE already handles all errors via `reject` above. This bare
        // .catch only exists to mark the promise as handled for runtimes
        // (like vitest) that surface unhandled rejections of detached IIFEs.
      });
    });

    const timer = setTimeout(() => {
      settle(() =>
        server.close(() => reject(new CliError('Browser login timed out after 5 minutes', 1))),
      );
    }, timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }

    server.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new CliError(`Loopback server error: ${err.message}`, 1)));
    });

    const port = opts.port ?? 0;
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : 0;
      const redirect = `http://127.0.0.1:${actualPort}/token`;
      const url = new URL('/cli/auth', opts.siteUrl);
      url.searchParams.set('redirect_uri', redirect);
      url.searchParams.set('state', state);
      if (opts.onUrl) opts.onUrl(url.toString());
    });
  });
}

/**
 * Inbound handler result: discriminated by `kind` so callers can switch on the
 * outcome rather than relying on thrown promises (which would surface as
 * unhandled rejections in test environments observing the server callback).
 */
type HandleResult =
  | { kind: 'noop' }
  | { kind: 'token'; token: string }
  | { kind: 'error'; error: CliError };

/**
 * Validate the inbound POST /token request:
 *   - method must be POST
 *   - path must be /token
 *   - body must be JSON with { token: string, state: string }
 *   - state must match the expected CSRF state
 *
 * Returns a discriminated result. Always responds.
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedState: string,
): Promise<HandleResult> {
  if (req.method !== 'POST' || req.url !== '/token') {
    res.statusCode = 404;
    res.end('Not Found\n');
    return { kind: 'noop' };
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed: { token?: unknown; state?: unknown };
  try {
    parsed = JSON.parse(raw) as { token?: unknown; state?: unknown };
  } catch {
    res.statusCode = 400;
    res.end('Bad Request: invalid JSON\n');
    return {
      kind: 'error',
      error: new CliError('Browser login: malformed token response', 4),
    };
  }
  if (typeof parsed.state !== 'string' || parsed.state !== expectedState) {
    res.statusCode = 403;
    res.end('Forbidden: state mismatch\n');
    return {
      kind: 'error',
      error: new CliError('Browser login: CSRF state mismatch', 3),
    };
  }
  if (typeof parsed.token !== 'string' || parsed.token.trim() === '') {
    res.statusCode = 400;
    res.end('Bad Request: missing token\n');
    return {
      kind: 'error',
      error: new CliError('Browser login: empty token in response', 4),
    };
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('Login complete. You may close this tab.\n');
  return { kind: 'token', token: parsed.token.trim() };
}
