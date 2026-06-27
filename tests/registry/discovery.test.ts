import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_REGISTRY,
  DEFAULT_SITE,
  resolveRegistry,
  registryUnavailableMessage,
} from '../../src/registry/discovery.js';
import { getTestMockAgent } from '../setup.js';

describe('registry/discovery', () => {
  const ORIGIN = 'https://cloudtrik.com';

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

  it('falls back to DEFAULT_REGISTRY when /.well-known 404 and no cache', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/.well-known/cloudtrik-hub.json', method: 'GET' }).reply(404, 'nope');
    const result = await resolveRegistry({ site: ORIGIN });
    expect(result.apiBase).toBe(DEFAULT_REGISTRY);
    expect(result.source).toBe('default');
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

  it('exposes a default site constant', () => {
    expect(DEFAULT_SITE).toBe('https://cloudtrik.com');
  });

  it('registryUnavailableMessage references the site URL', () => {
    const msg = registryUnavailableMessage('https://example.com');
    expect(msg).toContain('example.com');
    expect(msg).toContain('github.com/Cloudtrik/Cloudtrik-hub');
  });
});
