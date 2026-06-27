import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request as undiciRequest, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { loginViaBrowser } from '../../src/auth/browser.js';
import { readToken } from '../../src/auth/config.js';
import { makeTempDir, cleanupTempDir } from '../setup.js';
import { join } from 'node:path';

describe('auth/browser', () => {
  let tempDir: string;
  const originalDispatcher = getGlobalDispatcher();

  beforeEach(async () => {
    tempDir = await makeTempDir('cloudtrik-hub-browser-');
    process.env.CLOUDTRIK_HUB_CONFIG_PATH = join(tempDir, 'config.json');
    // Browser auth uses raw HTTP on 127.0.0.1; bypass MockAgent for this test only.
    setGlobalDispatcher(originalDispatcher);
  });

  afterEach(async () => {
    delete process.env.CLOUDTRIK_HUB_CONFIG_PATH;
    await cleanupTempDir(tempDir);
  });

  it('captures token via loopback POST with valid state', async () => {
    let capturedUrl = '';
    const loginPromise = loginViaBrowser({
      siteUrl: 'https://example.test',
      port: 0,
      timeoutMs: 5000,
      label: 'test-label',
      onUrl: (u) => {
        capturedUrl = u;
      },
    });

    // Wait briefly for server to bind and onUrl to fire.
    await new Promise((r) => setTimeout(r, 100));
    expect(capturedUrl).toContain('/cli/auth');
    expect(capturedUrl).toContain('redirect_uri=');
    expect(capturedUrl).toContain('state=');

    // Extract redirect_uri + state from the URL.
    const url = new URL(capturedUrl);
    const redirect = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    expect(redirect).toBeTruthy();
    expect(state).toBeTruthy();
    if (!redirect || !state) return;

    // POST the token back as the browser-side completion would.
    const tokenRes = await undiciRequest(redirect, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'browser-token-123', state }),
    });
    expect(tokenRes.statusCode).toBe(200);
    await tokenRes.body.dump();

    const result = await loginPromise;
    expect(result.token).toBe('browser-token-123');
    expect(await readToken()).toBe('browser-token-123');
  });

  it('rejects request with state mismatch', async () => {
    let capturedUrl = '';
    const loginPromise = loginViaBrowser({
      siteUrl: 'https://example.test',
      port: 0,
      timeoutMs: 5000,
      onUrl: (u) => {
        capturedUrl = u;
      },
    });
    // Eagerly attach a no-op rejection handler so the rejection doesn't surface
    // as "unhandled" between the time it fires and the time `await expect(...)`
    // re-observes it. The variable below still throws as expected when awaited.
    const observed = loginPromise.then(
      () => ({ ok: true as const }),
      (err: Error) => ({ ok: false as const, err }),
    );
    await new Promise((r) => setTimeout(r, 100));
    const url = new URL(capturedUrl);
    const redirect = url.searchParams.get('redirect_uri');
    if (!redirect) return;
    const wrongRes = await undiciRequest(redirect, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'x', state: 'wrong-state-token' }),
    });
    expect(wrongRes.statusCode).toBe(403);
    await wrongRes.body.dump();
    const result = await observed;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err.message).toMatch(/state mismatch|CSRF/);
    }
  });

  it('rejects request with missing token field', async () => {
    let capturedUrl = '';
    const loginPromise = loginViaBrowser({
      siteUrl: 'https://example.test',
      port: 0,
      timeoutMs: 5000,
      onUrl: (u) => {
        capturedUrl = u;
      },
    });
    const observed = loginPromise.then(
      () => ({ ok: true as const }),
      (err: Error) => ({ ok: false as const, err }),
    );
    await new Promise((r) => setTimeout(r, 100));
    const url = new URL(capturedUrl);
    const redirect = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    if (!redirect || !state) return;
    const res = await undiciRequest(redirect, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    expect(res.statusCode).toBe(400);
    await res.body.dump();
    const result = await observed;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err.message).toMatch(/empty token|missing/);
    }
  });
});
