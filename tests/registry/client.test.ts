import { describe, it, expect } from 'vitest';
import { getJson, postJson, getBytes } from '../../src/registry/client.js';
import { getTestMockAgent } from '../setup.js';

describe('registry/client', () => {
  const ORIGIN = 'https://api.example';

  it('getJson parses JSON 200 response', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/api/foo', method: 'GET' }).reply(200, { hello: 'world' });
    const res = await getJson(ORIGIN, '/api/foo');
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ hello: 'world' });
  });

  it('getJson injects Authorization header when token supplied', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/api/secret',
        method: 'GET',
        headers: { authorization: 'Bearer abc123' },
      })
      .reply(200, { ok: true });
    const res = await getJson(ORIGIN, '/api/secret', 'abc123');
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ ok: true });
  });

  it('postJson sends JSON body', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/api/upload',
        method: 'POST',
        body: JSON.stringify({ slug: 'x' }),
      })
      .reply(200, { uploadUrl: 'https://up.example/abc' });
    const res = await postJson(ORIGIN, '/api/upload', { slug: 'x' });
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ uploadUrl: 'https://up.example/abc' });
  });

  it('getBytes downloads binary content', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    const payload = Buffer.from([1, 2, 3, 4, 5]);
    pool.intercept({ path: '/api/file', method: 'GET' }).reply(200, payload);
    const bytes = await getBytes(ORIGIN, '/api/file');
    expect(bytes.length).toBe(5);
    expect(bytes[0]).toBe(1);
    expect(bytes[4]).toBe(5);
  });

  it('getBytes throws on non-200', async () => {
    const agent = getTestMockAgent();
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/api/missing', method: 'GET' }).reply(404, 'nope');
    await expect(getBytes(ORIGIN, '/api/missing')).rejects.toThrow(/HTTP 404/);
  });
});
