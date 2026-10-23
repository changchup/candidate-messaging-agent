import { describe, expect, it } from 'vitest';
import { buildTestApi, RECRUITER, VIEWER } from '../helpers/api.ts';

async function awaitingRun(env?: Record<string, string>) {
  const api = buildTestApi({ env });
  const res = await api.app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: RECRUITER,
    payload: { candidateId: 'c-001', jobId: 'j-001' },
  });
  return { ...api, run: res.json().run };
}

const post = (
  app: Awaited<ReturnType<typeof awaitingRun>>['app'],
  url: string,
  payload: object,
  headers = RECRUITER,
) => app.inject({ method: 'POST', url, headers, payload });

describe('POST /api/runs/:id/approve', () => {
  it('200: sends the draft and records the approval', async () => {
    const { app, ctx, run } = await awaitingRun();
    const res = await post(app, `/api/runs/${run.id}/approve`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().run).toMatchObject({ state: 'sent', messageId: 'msg-1' });
    expect(ctx.provider.outbox[0]).toMatchObject({
      to: 'priya.sharma@example.com',
      subject: run.draft.subject,
    });
    const approval = res.json().run.events.find((e: { type: string }) => e.type === 'human_action');
    expect(approval.data).toEqual({ action: 'approve', actor: 'recruiter', edited: false });
  });

  it('200: sends the recruiter edit', async () => {
    const { app, ctx, run } = await awaitingRun();
    const body = 'Hi Priya, would you be free for a Senior Backend Engineer interview? Talent Team';
    const res = await post(app, `/api/runs/${run.id}/approve`, { body });
    expect(res.json().run.draft.body).toBe(body);
    expect(ctx.provider.outbox[0]?.body).toBe(body);
  });

  it('422: an unsafe edit is refused and the run stays awaiting approval', async () => {
    const { app, ctx, run } = await awaitingRun();
    const res = await post(app, `/api/runs/${run.id}/approve`, {
      body: 'Hi Priya, before we proceed please confirm your date of birth.',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toEqual({
      code: 'DRAFT_REJECTED',
      message: 'Edited draft failed safety and grounding checks',
      details: ['Message raises a protected topic (age).'],
    });
    expect(ctx.store.get(run.id)?.state).toBe('awaiting_approval');
    expect(ctx.provider.outbox).toEqual([]);
  });

  it.each([
    [{ body: '' }],
    [{ subject: 'x'.repeat(201) }],
    [{ to: 'ceo@example.com' }], // recipient cannot be overridden
  ])('400 for invalid edit %j', async (payload) => {
    const { app, ctx, run } = await awaitingRun();
    const res = await post(app, `/api/runs/${run.id}/approve`, payload);
    expect(res.statusCode).toBe(400);
    expect(ctx.provider.outbox).toEqual([]);
  });

  it('403 for viewers', async () => {
    const { app, ctx, run } = await awaitingRun();
    expect((await post(app, `/api/runs/${run.id}/approve`, {}, VIEWER)).statusCode).toBe(403);
    expect(ctx.provider.outbox).toEqual([]);
  });

  it('401 without a token', async () => {
    const { app, run } = await awaitingRun();
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('404 for an unknown run', async () => {
    const { app } = await awaitingRun();
    expect((await post(app, '/api/runs/missing/approve', {})).statusCode).toBe(404);
  });

  it('409 when approving twice', async () => {
    const { app, ctx, run } = await awaitingRun();
    await post(app, `/api/runs/${run.id}/approve`, {});
    const res = await post(app, `/api/runs/${run.id}/approve`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: 'INVALID_STATE',
      message: 'Run is sent; this action is not allowed',
    });
    expect(ctx.provider.outbox).toHaveLength(1);
  });

  it('email provider down: send_failed with reason, then retry after recovery', async () => {
    const { app, ctx, run } = await awaitingRun({ EMAIL_PROVIDER: 'down' });
    const failed = (await post(app, `/api/runs/${run.id}/approve`, {})).json().run;
    expect(failed).toMatchObject({ state: 'send_failed', error: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(failed.error.message).toMatch(/approve again to retry/);

    ctx.emailStatus.current = 'up';
    expect((await post(app, `/api/runs/${run.id}/approve`, {})).json().run.state).toBe('sent');
  });
});

describe('POST /api/runs/:id/reject', () => {
  it('200: rejects without sending', async () => {
    const { app, ctx, run } = await awaitingRun();
    const res = await post(app, `/api/runs/${run.id}/reject`, { reason: 'Role paused' });
    expect(res.json().run.state).toBe('rejected');
    expect(ctx.provider.outbox).toEqual([]);
  });

  it('400 without a reason', async () => {
    const { app, run } = await awaitingRun();
    expect((await post(app, `/api/runs/${run.id}/reject`, {})).statusCode).toBe(400);
  });

  it('403 for viewers', async () => {
    const { app, run } = await awaitingRun();
    expect(
      (await post(app, `/api/runs/${run.id}/reject`, { reason: 'x' }, VIEWER)).statusCode,
    ).toBe(403);
  });

  it('409 once sent', async () => {
    const { app, run } = await awaitingRun();
    await post(app, `/api/runs/${run.id}/approve`, {});
    expect((await post(app, `/api/runs/${run.id}/reject`, { reason: 'x' })).statusCode).toBe(409);
  });
});
