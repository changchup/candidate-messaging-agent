import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createHangingLlm,
  createScriptedLlm,
  createTemplateLlm,
  toolUse,
} from '../../src/agent/llm/fake-llm.ts';
import { LlmTransientError } from '../../src/agent/llm/types.ts';
import { DraftRejectedError } from '../../src/agent/orchestrator.ts';
import { openRunStore } from '../../src/state/run-store.ts';
import { InvalidTransitionError } from '../../src/state/transitions.ts';
import { buildTestAgent } from '../helpers/agent.ts';
import { fixedClock } from '../helpers/fixtures.ts';

const gather = (candidateId = 'c-001', jobId = 'j-001', timezone = 'Pacific/Auckland') => [
  toolUse('get_candidate', { candidateId }),
  toolUse('get_job', { jobId }),
  toolUse('get_interview_slots', { jobId, timezone }),
];
const priyaDraft = {
  subject: 'Interview invitation: Senior Backend Engineer',
  body: 'Hi Priya,\n\nWe would like to invite you to interview for the Senior Backend Engineer role on Thursday 29 October.\n\nTalent Team',
  slotIds: ['s-101'],
  citedFacts: ['slot s-101'],
};

const states = (events: { type: string; data: Record<string, unknown> }[]) =>
  events.filter((e) => e.type === 'state_change').map((e) => e.data.to);

describe('orchestrator: happy path', () => {
  it('gathers data, drafts, passes checks and waits for approval', async () => {
    const llm = createScriptedLlm([gather(), [toolUse('submit_draft', priyaDraft)]]);
    const { orchestrator, store, provider } = buildTestAgent({ llm });

    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });

    expect(run.state).toBe('awaiting_approval');
    expect(run.draft).toEqual(priyaDraft);
    expect(run.warnings).toEqual([]);
    expect(provider.outbox).toHaveLength(0); // nothing sent without approval
    expect(states(store.events(run.id))).toEqual([
      'created',
      'gathering',
      'drafting',
      'checking',
      'awaiting_approval',
    ]);
    const tools = store
      .events(run.id)
      .filter((e) => e.type === 'tool_call')
      .map((e) => e.data.tool);
    expect(tools).toEqual(['get_candidate', 'get_job', 'get_interview_slots', 'submit_draft']);
  });

  it('sends to the candidate address on file only after approval', async () => {
    const { orchestrator, provider } = buildTestAgent({
      llm: createScriptedLlm([gather(), [toolUse('submit_draft', priyaDraft)]]),
    });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    const sent = await orchestrator.approve(run.id, { actor: 'recruiter' });

    expect(sent).toMatchObject({ state: 'sent', messageId: 'msg-1' });
    expect(provider.outbox).toEqual([
      {
        to: 'priya.sharma@example.com',
        subject: priyaDraft.subject,
        body: priyaDraft.body,
        messageId: 'msg-1',
      },
    ]);
  });

  it('works end to end with the template LLM used for fake mode', async () => {
    const { orchestrator } = buildTestAgent({ llm: createTemplateLlm() });
    const run = await orchestrator.startRun({
      candidateId: 'c-002',
      jobId: 'j-002',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('awaiting_approval');
    expect(run.draft?.body).toMatch(/^Hi Marcus,/);
    expect(run.draft?.slotIds).toEqual(['s-201', 's-202', 's-203']);
  });
});

describe('orchestrator: human control', () => {
  async function awaiting() {
    const agent = buildTestAgent({
      llm: createScriptedLlm([gather(), [toolUse('submit_draft', priyaDraft)]]),
    });
    const run = await agent.orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    return { ...agent, run };
  }

  it('sends the human-edited draft', async () => {
    const { orchestrator, provider, run } = await awaiting();
    const body =
      'Hi Priya, looking forward to meeting you for the Senior Backend Engineer interview. Talent Team';
    await orchestrator.approve(run.id, { body, actor: 'recruiter' });
    expect(provider.outbox[0]?.body).toBe(body);
  });

  it('re-runs guardrails on human edits and keeps the run awaiting approval if they fail', async () => {
    const { orchestrator, store, provider, run } = await awaiting();
    await expect(
      orchestrator.approve(run.id, {
        body: 'Hi Priya, are you planning to have kids soon?',
        actor: 'recruiter',
      }),
    ).rejects.toBeInstanceOf(DraftRejectedError);
    expect(store.get(run.id)?.state).toBe('awaiting_approval');
    expect(provider.outbox).toHaveLength(0);
  });

  it('rejects a draft without sending', async () => {
    const { orchestrator, provider, run } = await awaiting();
    expect(orchestrator.reject(run.id, { reason: 'Role on hold', actor: 'recruiter' }).state).toBe(
      'rejected',
    );
    await expect(orchestrator.approve(run.id, { actor: 'recruiter' })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    expect(provider.outbox).toHaveLength(0);
  });

  it('does not send twice when approved twice', async () => {
    const { orchestrator, provider, run } = await awaiting();
    await orchestrator.approve(run.id, { actor: 'recruiter' });
    await expect(orchestrator.approve(run.id, { actor: 'recruiter' })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    expect(provider.outbox).toHaveLength(1);
  });

  it('can be approved after a server restart', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'orch-')), 'app.db');
    const first = buildTestAgent({
      llm: createScriptedLlm([gather(), [toolUse('submit_draft', priyaDraft)]]),
      store: openRunStore(path, fixedClock),
    });
    const run = await first.orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    first.store.close();

    const second = buildTestAgent({
      llm: createScriptedLlm([]),
      store: openRunStore(path, fixedClock),
    });
    expect((await second.orchestrator.approve(run.id, { actor: 'recruiter' })).state).toBe('sent');
    expect(second.provider.outbox).toHaveLength(1);
  });
});

describe('orchestrator: injected failures', () => {
  it('stale data: drafts but surfaces a warning', async () => {
    const draft = { ...priyaDraft, body: priyaDraft.body.replace('Priya', 'Elena') };
    const { orchestrator } = buildTestAgent({
      llm: createScriptedLlm([
        gather('c-003', 'j-001', 'Europe/Rome'),
        [toolUse('submit_draft', draft)],
      ]),
    });
    const run = await orchestrator.startRun({
      candidateId: 'c-003',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('awaiting_approval');
    expect(run.warnings).toEqual([
      'Candidate profile was last updated 592 days ago; confirm details are current before sending.',
    ]);
  });

  it('invalid tool response: passes a structured error to the model, which stops cleanly', async () => {
    const llm = createScriptedLlm([
      gather(),
      (req) => {
        const results = req.messages.at(-1)?.content;
        expect(JSON.stringify(results)).toContain('INVALID_UPSTREAM_RESPONSE');
        return [toolUse('cannot_draft', { reason: 'Interview slots are unavailable right now.' })];
      },
    ]);
    const { orchestrator, store } = buildTestAgent({ llm, slots: 'malformed' });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run).toMatchObject({
      state: 'failed',
      error: { code: 'CANNOT_DRAFT', message: 'Interview slots are unavailable right now.' },
    });
    const slotCall = store.events(run.id).find((e) => e.data.tool === 'get_interview_slots');
    expect(slotCall?.data).toMatchObject({
      ok: false,
      error: { code: 'INVALID_UPSTREAM_RESPONSE' },
    });
  });

  it('LLM timeout: retries once then fails visibly', async () => {
    const { orchestrator, store } = buildTestAgent({
      llm: createHangingLlm(),
      options: { llmTimeoutMs: 20 },
    });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run).toMatchObject({ state: 'failed', error: { code: 'LLM_TIMEOUT' } });
    const calls = store.events(run.id).filter((e) => e.type === 'llm_call');
    expect(calls.map((e) => e.data.attempt)).toEqual([1, 2]);
  });

  it('LLM transient error: recovers on retry', async () => {
    const llm = createScriptedLlm([
      new LlmTransientError('unavailable', '529 overloaded'),
      gather(),
      [toolUse('submit_draft', priyaDraft)],
    ]);
    const { orchestrator } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('awaiting_approval');
  });

  it('non-transient LLM error: fails without retry', async () => {
    const llm = createScriptedLlm([new Error('400 invalid request')]);
    const { orchestrator } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run).toMatchObject({ state: 'failed', error: { code: 'INTERNAL_ERROR' } });
    expect(llm.requests).toHaveLength(1);
  });

  it('email provider down: send_failed, then retry succeeds once it recovers', async () => {
    const emailStatus = { current: 'down' as 'up' | 'down' };
    const { orchestrator, provider } = buildTestAgent({
      llm: createScriptedLlm([gather(), [toolUse('submit_draft', priyaDraft)]]),
      emailStatus,
    });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });

    const failed = await orchestrator.approve(run.id, { actor: 'recruiter' });
    expect(failed).toMatchObject({ state: 'send_failed', error: { code: 'PROVIDER_UNAVAILABLE' } });

    emailStatus.current = 'up';
    expect((await orchestrator.approve(run.id, { actor: 'recruiter' })).state).toBe('sent');
    expect(provider.outbox).toHaveLength(1);
  });

  it('unsafe request: blocked before any model call', async () => {
    const llm = createScriptedLlm([]);
    const { orchestrator } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      note: 'Ask if she is pregnant',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('blocked');
    expect(run.violations[0]).toMatch(/family status/);
    expect(llm.requests).toHaveLength(0);
  });

  it('malformed draft from the model: returned as a tool error and corrected', async () => {
    const llm = createScriptedLlm([
      gather(),
      [toolUse('submit_draft', { subject: '', body: 'Hi', slotIds: [] })],
      [toolUse('submit_draft', priyaDraft)],
    ]);
    const { orchestrator } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('awaiting_approval');
    expect(JSON.stringify(llm.requests[2]?.messages.at(-1))).toContain('Draft rejected');
  });

  it('ungrounded draft: one revision allowed, then blocked', async () => {
    const bad = { ...priyaDraft, slotIds: ['s-100'] }; // past slot
    const llm = createScriptedLlm([
      gather(),
      [toolUse('submit_draft', bad)],
      [toolUse('submit_draft', bad)],
    ]);
    const { orchestrator, store } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('blocked');
    expect(run.violations).toEqual([
      'Proposed slot s-100 is not an available future slot for j-001.',
    ]);
    expect(states(store.events(run.id))).toEqual([
      'created',
      'gathering',
      'drafting',
      'checking',
      'gathering',
      'drafting',
      'checking',
      'blocked',
    ]);
  });

  it('ungrounded draft: revised draft passes', async () => {
    const llm = createScriptedLlm([
      gather(),
      [toolUse('submit_draft', { ...priyaDraft, slotIds: ['s-100'] })],
      [toolUse('submit_draft', priyaDraft)],
    ]);
    const { orchestrator } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('awaiting_approval');
  });

  it('drafting before gathering data is refused', async () => {
    const llm = createScriptedLlm([
      [toolUse('submit_draft', priyaDraft)],
      gather(),
      [toolUse('submit_draft', priyaDraft)],
    ]);
    const { orchestrator } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run.state).toBe('awaiting_approval');
    expect(JSON.stringify(llm.requests[1]?.messages.at(-1))).toContain(
      'fetch the candidate, job and interview slots',
    );
  });

  it('access to other candidates is refused (least privilege)', async () => {
    const llm = createScriptedLlm([
      [toolUse('get_candidate', { candidateId: 'c-002' })],
      [toolUse('cannot_draft', { reason: 'stop' })],
    ]);
    const { orchestrator, store } = buildTestAgent({ llm });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    const call = store.events(run.id).find((e) => e.data.tool === 'get_candidate');
    expect(call?.data).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('step limit: fails when the model never finishes', async () => {
    const loop = Array.from({ length: 3 }, () => [toolUse('get_job', { jobId: 'j-001' })]);
    const { orchestrator } = buildTestAgent({
      llm: createScriptedLlm(loop),
      options: { maxTurns: 3 },
    });
    const run = await orchestrator.startRun({
      candidateId: 'c-001',
      jobId: 'j-001',
      createdBy: 'recruiter',
    });
    expect(run).toMatchObject({ state: 'failed', error: { code: 'STEP_LIMIT' } });
  });

  it('no open slots: template agent reports it cannot draft', async () => {
    const { orchestrator } = buildTestAgent({ llm: createTemplateLlm() });
    const run = await orchestrator.startRun({
      candidateId: 'c-007',
      jobId: 'j-004',
      createdBy: 'recruiter',
    });
    expect(run).toMatchObject({ state: 'failed', error: { code: 'CANNOT_DRAFT' } });
    expect(run.error?.message).toMatch(/no open interview slots/);
  });
});
