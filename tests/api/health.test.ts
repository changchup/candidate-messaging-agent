import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.ts';

describe('GET /api/health', () => {
  it('returns ok without auth', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
