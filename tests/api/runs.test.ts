import { describe, expect, it } from 'vitest';
import { createHangingLlm, createScriptedLlm } from '../../src/agent/llm/fake-llm.ts';
import { buildTestApi, RECRUITER, VIEWER } from '../helpers/api.ts';

const create = (
  app: ReturnType<typeof buildTestApi>['app'],
  payload: unknown,
  headers = RECRUITER,
) => app.inject({ method: 'POST', url: '/api/runs', headers, payload: payload as object });

describe('POST /api/runs', () => {
  it('201: runs the agent to awaiting approval and returns the draft with its history', async () => {
    const { app } = buildTestApi();
    const res = await create(app, { candidateId: 'c-001', jobId: 'j-001' });
    expect(res.statusCode).toBe(201);
    const { run } = res.json();
    expect(run).toMatchObject({
      state: 'awaiting_approval',
      candidateId: 'c-001',
      recipient: 'priya.sharma@example.com',
      createdBy: 'recruiter',
      warnings: [],
      error: null,
    });
    expect(run.draft.body).toMatch(/^Hi Priya,/);
    expect(run.proposedSlots.map((s: { id: string }) => s.id)).toEqual(['s-101', 's-102', 's-103']);
    expect(run.events.length).toBeGreaterThan(5);
  });

  it('is retrievable afterwards by id and in the list', async () => {
    const { app } = buildTestApi();
    const { run } = (await create(app, { candidateId: 'c-001', jobId: 'j-001' })).json();
    const one = await app.inject({ method: 'GET', url: `/api/runs/${run.id}`, headers: VIEWER });
    expect(one.json().run.state).toBe('awaiting_approval');
    const list = await app.inject({ method: 'GET', url: '/api/runs', headers: VIEWER });
    expect(list.json().runs.map((r: { id: string }) => r.id)).toEqual([run.id]);
  });

  it.each([
    [{}, { candidateId: expect.any(Array), jobId: expect.any(Array) }],
    [{ candidateId: '  ', jobId: 'j-001' }, { candidateId: expect.any(Array) }],
    [{ candidateId: 'c-001', jobId: 'j-001', note: 'x'.repeat(501) }, { note: expect.any(Array) }],
    [{ candidateId: 42, jobId: 'j-001' }, { candidateId: expect.any(Array) }],
  ])('400 for invalid body %j', async (payload, details) => {
    const { app } = buildTestApi();
    const res = await create(app, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request body is invalid',
      details,
    });
  });

  it('400 for malformed JSON', async () => {
    const { app } = buildTestApi();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { ...RECRUITER, 'content-type': 'application/json' },
      payload: '{"candidateId":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBeDefined();
  });

  it('404 for unknown candidate or job, without creating a run', async () => {
    const { app, ctx } = buildTestApi();
    expect((await create(app, { candidateId: 'c-999', jobId: 'j-001' })).statusCode).toBe(404);
    expect((await create(app, { candidateId: 'c-001', jobId: 'j-999' })).statusCode).toBe(404);
    expect(ctx.store.list()).toEqual([]);
  });

  it('401 without a token', async () => {
    const { app } = buildTestApi();
    expect(
      (await create(app, { candidateId: 'c-001', jobId: 'j-001' }, {} as typeof RECRUITER))
        .statusCode,
    ).toBe(401);
  });

  it('403 for viewers', async () => {
    const { app, ctx } = buildTestApi();
    const res = await create(app, { candidateId: 'c-001', jobId: 'j-001' }, VIEWER);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({
      code: 'FORBIDDEN',
      message: 'This action requires the recruiter role',
    });
    expect(ctx.store.list()).toEqual([]);
  });

  it('LLM timeout: 201 with a failed run and a user-visible reason', async () => {
    const { app } = buildTestApi({ llm: createHangingLlm(), env: { LLM_TIMEOUT_MS: '20' } });
    const { run } = (await create(app, { candidateId: 'c-001', jobId: 'j-001' })).json();
    expect(run.state).toBe('failed');
    expect(run.error.code).toBe('LLM_TIMEOUT');
    expect(run.error.message).toMatch(/did not respond/);
  });

  it('malformed calendar data: failed run explains slots are unavailable', async () => {
    const { app } = buildTestApi({ env: { SLOTS_SOURCE: 'malformed' } });
    const { run } = (await create(app, { candidateId: 'c-001', jobId: 'j-001' })).json();
    expect(run).toMatchObject({ state: 'failed', error: { code: 'CANNOT_DRAFT' } });
    expect(run.error.message).toMatch(/INVALID_UPSTREAM_RESPONSE/);
  });

  it('stale candidate: draft carries a warning', async () => {
    const { app } = buildTestApi();
    const { run } = (await create(app, { candidateId: 'c-003', jobId: 'j-001' })).json();
    expect(run.state).toBe('awaiting_approval');
    expect(run.warnings[0]).toMatch(/592 days ago/);
  });

  it('unsafe note: blocked with the reason', async () => {
    const { app } = buildTestApi({ llm: createScriptedLlm([]) });
    const { run } = (
      await create(app, { candidateId: 'c-001', jobId: 'j-001', note: 'ask about her religion' })
    ).json();
    expect(run.state).toBe('blocked');
    expect(run.violations[0]).toMatch(/religion/);
  });

  it('500 does not leak internals', async () => {
    const { app, ctx } = buildTestApi();
    ctx.store.close(); // simulate the database going away
    const res = await create(app, { candidateId: 'c-001', jobId: 'j-001' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });
});
