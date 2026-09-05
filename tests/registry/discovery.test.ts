import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_REGISTRY,
  DEFAULT_SITE,
  resolveRegistry,
  registryUnavailableMessage,
} from '../../src/registry/discovery.js';
import { getTestMockAgent } from '../setup.js';

describe('registry/discovery', () => {
  // The built-in default site. Discovery misses on THIS origin fall back to
  // DEFAULT_REGISTRY; misses on an operator-supplied origin fail closed.
  const ORIGIN = DEFAULT_SITE;
  const FOREIGN_SITE = 'https://not-a-registry.example';

  beforeEach(() => {
    delete process.env.CLOUDTRIK_HUB_REGISTRY;
    delete process.env.CLOUDTRIK_HUB_SITE;
  });

  it('explicit --registry has highest precedence', async () => {
    const result = await resolveRegistry({ registry: 'https://explicit.example' });
    expect(result.apiBase).toBe('https://explicit.example');
    expect(result.source).toBe('explicit');
  });

  it('CLOUDTRIK_HUB_REGISTRY env var beats discovery and default', async () => {
    process.env.CLOUDTRIK_HUB_REGISTRY = 'https://env.example';
    const result = await resolveRegistry({});
    expect(result.apiBase).toBe('https://env.example');
    expect(result.source).toBe('env');
    delete process.env.CLOUDTRIK_HUB_REGISTRY;
  });

  it('uses /.well-known result when site returns 200 with valid shape', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool
      .intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' })
      .reply(200, { apiBase: 'https://api.cloudtrik.example' });
    const result = await resolveRegistry({ site: ORIGIN });
    expect(result.apiBase).toBe('https://api.cloudtrik.example');
    expect(result.source).toBe('well-known');
  });

  it('falls back to cachedRegistry when /.well-known returns 404', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' }).reply(404, 'nope');
    const result = await resolveRegistry({
      site: ORIGIN,
      cachedRegistry: 'https://cached.example',
    });
    expect(result.apiBase).toBe('https://cached.example');
    expect(result.source).toBe('cached');
  });

  it('falls back to DEFAULT_REGISTRY when the DEFAULT site 404s and no cache', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' }).reply(404, 'nope');
    const result = await resolveRegistry({ site: ORIGIN });
    expect(result.apiBase).toBe(DEFAULT_REGISTRY);
    expect(result.source).toBe('default');
  });

  it('FAILS CLOSED when an operator-supplied site advertises no registry', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(FOREIGN_SITE);
    pool.intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' }).reply(404, 'nope');
    await expect(resolveRegistry({ site: FOREIGN_SITE })).rejects.toThrow(/not yet reachable/);
    // …and it names the site the caller actually asked for, not a substitute.
    await expect(resolveRegistry({ site: FOREIGN_SITE })).rejects.toThrow(
      /not-a-registry\.example/,
    );
  });

  it('FAILS CLOSED for a CLOUDTRIK_HUB_SITE override with no registry', async () => {
    process.env.CLOUDTRIK_HUB_SITE = FOREIGN_SITE;
    const agent = getTestMockAgent();
    const pool = agent.get(FOREIGN_SITE);
    pool.intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' }).reply(404, 'nope');
    await expect(resolveRegistry({})).rejects.toThrow(/not yet reachable/);
    delete process.env.CLOUDTRIK_HUB_SITE;
  });

  it('an operator-supplied site still honours an explicit cachedRegistry', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(FOREIGN_SITE);
    pool.intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' }).reply(404, 'nope');
    const result = await resolveRegistry({
      site: FOREIGN_SITE,
      cachedRegistry: 'https://cached.example',
    });
    expect(result.apiBase).toBe('https://cached.example');
    expect(result.source).toBe('cached');
  });

  it('treats malformed /.well-known JSON as miss', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool
      .intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' })
      .reply(200, { wrongKey: 'value' });
    const result = await resolveRegistry({ site: ORIGIN });
    expect(result.source).toBe('default');
  });

  it('the default site and registry are the registry origin, not the marketing site', () => {
    // Regression guard for the 0.1.0 defect: both constants pointed at an
    // origin that serves no registry routes, so the CLI was broken out of the
    // box in every context without an environment override.
    expect(DEFAULT_SITE).toBe('https://hub.cloudtrik.com');
    expect(DEFAULT_REGISTRY).toBe('https://hub.cloudtrik.com');
    expect(DEFAULT_SITE).not.toBe('https://cloudtrik.com');
    expect(DEFAULT_REGISTRY).not.toBe('https://cloudtrik.com');
  });

  it('registryUnavailableMessage references the site URL', () => {
    const msg = registryUnavailableMessage('https://example.com');
    expect(msg).toContain('example.com');
    expect(msg).toContain('github.com/Cloudtrik/Cloudtrik-hub');
  });
});
