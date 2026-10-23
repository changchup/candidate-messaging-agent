import { describe, expect, it } from 'vitest';
import { buildTestApi, RECRUITER, VIEWER } from '../helpers/api.ts';

describe('GET /api/health', () => {
  it('is public', async () => {
    const { app } = buildTestApi();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', llmMode: 'fake' });
  });
});

describe.each([['/api/candidates'], ['/api/jobs'], ['/api/runs'], ['/api/data/validation']])(
  'GET %s',
  (url) => {
    it('401 without a token', async () => {
      const { app } = buildTestApi();
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid bearer token' },
      });
    });

    it('401 with an unknown token', async () => {
      const { app } = buildTestApi();
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: 'Bearer nope' },
      });
      expect(res.statusCode).toBe(401);
    });

    it.each([
      ['viewer', VIEWER],
      ['recruiter', RECRUITER],
    ])('200 for %s', async (_role, headers) => {
      const { app } = buildTestApi();
      expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(200);
    });
  },
);

describe('GET /api/runs/:id', () => {
  it('404 for an unknown run', async () => {
    const { app } = buildTestApi();
    const res = await app.inject({ method: 'GET', url: '/api/runs/missing', headers: VIEWER });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('unknown routes', () => {
  it('return the standard error shape', async () => {
    const { app } = buildTestApi();
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: VIEWER });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No route GET /api/nope' } });
  });
});

describe('web UI hosting', () => {
  it('serves index.html for client routes but still 404s unknown API routes', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { buildApp } = await import('../../src/api/app.ts');
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
    const { ctx } = buildTestApi();
    const app = buildApp(ctx, { webDir: dir });

    const page = await app.inject({ method: 'GET', url: '/runs/123' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="root"');
    const api = await app.inject({ method: 'GET', url: '/api/nope', headers: VIEWER });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('NOT_FOUND');
  });
});
