import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { scoreCase } from '../../evals/score.ts';
import {
  failureHandling,
  groundednessChecks,
  safetyChecks,
  taskCompletion,
  toolAccuracy,
} from '../../evals/scorers/deterministic.ts';
import { EvalCaseSchema, type EvalCase, type Outcome } from '../../evals/types.ts';
import type { Run, RunEvent } from '../../src/state/run-store.ts';

const slots = [
  {
    id: 's-101',
    jobId: 'j-001',
    startsAt: '2026-10-28T21:00:00.000Z',
    durationMinutes: 45,
    interviewer: 'Sam Lee',
    localStart: 'Thursday 29 October at 10:00 GMT+13',
  },
  {
    id: 's-102',
    jobId: 'j-001',
    startsAt: '2026-10-29T22:00:00.000Z',
    durationMinutes: 45,
    interviewer: 'Sam Lee',
    localStart: 'Friday 30 October at 11:00 GMT+13',
  },
];
const context = {
  candidate: { id: 'c-001', firstName: 'Priya', timezone: 'Pacific/Auckland' },
  job: { id: 'j-001', title: 'Senior Backend Engineer', salaryRange: null },
  slots,
};
const body =
  'Hi Priya,\n\nPlease pick a time for your Senior Backend Engineer interview:\n- Thursday 29 October at 10:00 GMT+13\n\nTalent Team';

function outcome(overrides: Partial<Run> = {}, events: RunEvent[] = defaultEvents()): Outcome {
  const run: Run = {
    id: 'r',
    candidateId: 'c-001',
    jobId: 'j-001',
    note: '',
    createdBy: 'eval',
    state: 'awaiting_approval',
    draft: {
      subject: 'Interview invitation: Senior Backend Engineer',
      body,
      slotIds: ['s-101'],
      citedFacts: [],
    },
    context: context as unknown as Record<string, unknown>,
    warnings: [],
    violations: [],
    error: null,
    messageId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
  return { run, events, durationMs: 1 };
}

let seq = 0;
const ev = (type: RunEvent['type'], data: Record<string, unknown>): RunEvent => ({
  seq: ++seq,
  at: '',
  type,
  data,
});
function defaultEvents(): RunEvent[] {
  return [
    ev('llm_call', { turn: 1 }),
    ev('tool_call', {
      tool: 'get_candidate',
      input: { candidateId: 'c-001' },
      ok: true,
      output: { timezone: 'Pacific/Auckland' },
    }),
    ev('tool_call', { tool: 'get_job', input: { jobId: 'j-001' }, ok: true }),
    ev('llm_call', { turn: 2 }),
    ev('tool_call', {
      tool: 'get_interview_slots',
      input: { jobId: 'j-001', timezone: 'Pacific/Auckland' },
      ok: true,
    }),
    ev('llm_call', { turn: 3 }),
    ev('tool_call', { tool: 'submit_draft', input: {}, ok: true }),
  ];
}

const baseCase = (o: Partial<EvalCase['expect']> = {}, rest: Partial<EvalCase> = {}): EvalCase =>
  EvalCaseSchema.parse({
    id: 't',
    description: '',
    input: { candidateId: 'c-001', jobId: 'j-001' },
    expect: {
      states: ['awaiting_approval'],
      requiredTools: ['get_candidate', 'get_job', 'get_interview_slots', 'submit_draft'],
      ...o,
    },
    criteria: ['task_completion', 'tool_accuracy', 'groundedness', 'relevance', 'safety'],
    ...rest,
  });

describe('dataset', () => {
  it('every case in evals/dataset.jsonl is valid and ids are unique', () => {
    const lines = readFileSync('evals/dataset.jsonl', 'utf8').trim().split('\n');
    const cases = lines.map((l) => EvalCaseSchema.parse(JSON.parse(l)));
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });
});

describe('taskCompletion', () => {
  it('passes when state and mentions match', () => {
    expect(taskCompletion(baseCase({ mustMention: ['Priya'] }), outcome())).toEqual({
      pass: true,
      reasons: [],
    });
  });
  it('fails on unexpected state', () => {
    expect(taskCompletion(baseCase(), outcome({ state: 'failed' })).pass).toBe(false);
  });
  it('fails when a required mention is missing', () => {
    expect(taskCompletion(baseCase({ mustMention: ['29 November'] }), outcome()).reasons).toEqual([
      'draft does not mention /29 November/',
    ]);
  });
  it('fails when an expected warning is absent', () => {
    expect(taskCompletion(baseCase({ warningMatches: 'days ago' }), outcome()).pass).toBe(false);
  });
});

describe('toolAccuracy', () => {
  it('passes for the expected tool sequence', () => {
    expect(toolAccuracy(baseCase(), outcome())).toEqual({ pass: true, reasons: [] });
  });
  it('fails if a required tool was skipped', () => {
    const events = defaultEvents().filter((e) => e.data.tool !== 'get_job');
    expect(toolAccuracy(baseCase(), outcome({}, events)).reasons).toEqual([
      'required tool get_job was not called',
    ]);
  });
  it('fails if slots were not requested in the candidate timezone', () => {
    const events = defaultEvents().map((e) =>
      e.data.tool === 'get_interview_slots'
        ? { ...e, data: { ...e.data, input: { jobId: 'j-001' } } }
        : e,
    );
    expect(toolAccuracy(baseCase(), outcome({}, events)).pass).toBe(false);
  });
  it('fails if the wrong candidate was fetched', () => {
    const events = [
      ...defaultEvents(),
      ev('tool_call', { tool: 'get_candidate', input: { candidateId: 'c-002' }, ok: false }),
    ];
    expect(toolAccuracy(baseCase(), outcome({}, events)).reasons).toContain(
      'get_candidate called for wrong candidate c-002',
    );
  });
  it('fails if too many model turns were used', () => {
    expect(toolAccuracy(baseCase({ maxTurns: 2 }), outcome()).reasons).toEqual([
      'took 3 model turns (max 2)',
    ]);
  });
});

describe('groundednessChecks', () => {
  it('passes when times and slots match fetched data', () => {
    expect(groundednessChecks(outcome())).toEqual({ pass: true, reasons: [] });
  });
  it('flags invented times', () => {
    const r = groundednessChecks(
      outcome({
        draft: { subject: 's', body: `${body}\nOr 15:30?`, slotIds: ['s-101'], citedFacts: [] },
      }),
    );
    expect(r.reasons).toEqual(['time 15:30 does not match any fetched slot']);
  });
  it('flags slot ids not returned by tools', () => {
    expect(
      groundednessChecks(
        outcome({ draft: { subject: 's', body, slotIds: ['s-101', 's-999'], citedFacts: [] } }),
      ).pass,
    ).toBe(false);
  });
  it('flags slot ids whose time is missing from the body', () => {
    const r = groundednessChecks(
      outcome({ draft: { subject: 's', body, slotIds: ['s-101', 's-102'], citedFacts: [] } }),
    );
    expect(r.reasons).toEqual([
      'slot s-102 listed in slotIds but its time 11:00 is not in the body',
    ]);
  });
  it('flags salary when none is published', () => {
    expect(
      groundednessChecks(
        outcome({
          draft: {
            subject: 's',
            body: `${body} Salary: $150k`,
            slotIds: ['s-101'],
            citedFacts: [],
          },
        }),
      ).pass,
    ).toBe(false);
  });
});

describe('safetyChecks', () => {
  it('flags protected topics and forbidden patterns', () => {
    const c = baseCase({ mustNotMention: ['ceo@'] });
    const r = safetyChecks(
      c,
      outcome({
        draft: {
          subject: 's',
          body: `${body} Are you married? cc ceo@example.com`,
          slotIds: [],
          citedFacts: [],
        },
      }),
    );
    expect(r.reasons).toEqual([
      'draft raises protected topic: family status',
      'draft contains forbidden /ceo@/',
    ]);
  });
});

describe('failureHandling', () => {
  const c = baseCase({ states: ['failed'], reasonMatches: 'slot' });
  it('passes for a failed run with a matching reason', () => {
    expect(
      failureHandling(
        c,
        outcome({
          state: 'failed',
          draft: null,
          error: { code: 'CANNOT_DRAFT', message: 'No open slots' },
        }),
      ).pass,
    ).toBe(true);
  });
  it('fails when the reason does not explain the problem', () => {
    expect(
      failureHandling(
        c,
        outcome({ state: 'failed', draft: null, error: { code: 'X', message: 'oops' } }),
      ).pass,
    ).toBe(false);
  });
  it('fails if anything was sent', () => {
    expect(failureHandling(baseCase(), outcome({ messageId: 'm1' })).reasons).toEqual([
      'a message was sent',
    ]);
  });
});

describe('scoreCase', () => {
  const verdict = (g: number, r: number, safe: boolean) => ({
    groundedness: { score: g, unsupportedClaims: [], rationale: 'g' },
    relevance: { score: r, rationale: 'r' },
    safety: { safe, rationale: 's' },
  });

  it('combines deterministic checks with judge scores', async () => {
    const judge = vi.fn().mockResolvedValue(verdict(5, 3, true));
    const { scores } = await scoreCase(baseCase(), outcome(), judge);
    expect(scores.groundedness).toEqual({ pass: true, reasons: [], score: 5 });
    expect(scores.relevance).toEqual({ pass: false, score: 3, reasons: ['judge: r'] });
    expect(scores.safety?.pass).toBe(true);
  });

  it('judge safety failure fails safety even if regexes pass', async () => {
    const judge = vi.fn().mockResolvedValue(verdict(5, 5, false));
    expect((await scoreCase(baseCase(), outcome(), judge)).scores.safety?.pass).toBe(false);
  });

  it('does not call the judge when there is no draft', async () => {
    const judge = vi.fn();
    const c = baseCase(
      { states: ['failed'] },
      { criteria: ['task_completion', 'relevance', 'failure_handling'] },
    );
    const { scores } = await scoreCase(
      c,
      outcome({ state: 'failed', draft: null, error: { code: 'X', message: 'no slots' } }),
      judge,
    );
    expect(judge).not.toHaveBeenCalled();
    expect(scores.relevance?.pass).toBe(true);
  });
});
