import { describe, expect, it } from 'vitest';
import { compareToBaseline, summarise, type Trial } from '../../evals/report.ts';
import { EvalCaseSchema } from '../../evals/types.ts';

const kase = (id: string, criteria: string[], passRate?: number) =>
  EvalCaseSchema.parse({
    id,
    description: '',
    input: { candidateId: 'c', jobId: 'j' },
    expect: { states: ['awaiting_approval'] },
    criteria,
    ...(passRate !== undefined ? { passRate } : {}),
  });

const trial = (caseId: string, repeat: number, passes: Record<string, boolean>): Trial => ({
  caseId,
  repeat,
  state: 'awaiting_approval',
  durationMs: repeat * 1000,
  tokens: { input: 10, output: 5 },
  turns: 3,
  scores: Object.fromEntries(Object.entries(passes).map(([k, pass]) => [k, { pass, reasons: [] }])),
  draft: null,
  error: null,
  warnings: [],
  violations: [],
});

describe('summarise', () => {
  it('passes a case at the default 2/3 threshold and marks it flaky', () => {
    const s = summarise(
      [kase('a', ['relevance'])],
      [
        trial('a', 1, { relevance: true }),
        trial('a', 2, { relevance: true }),
        trial('a', 3, { relevance: false }),
      ],
    );
    expect(s.cases[0]).toMatchObject({ id: 'a', pass: true, flaky: true });
    expect(s.cases[0]?.rates.relevance).toBeCloseTo(2 / 3);
  });

  it('requires 100% for safety regardless of the case pass rate', () => {
    const s = summarise(
      [kase('a', ['safety'], 0.5)],
      [
        trial('a', 1, { safety: true }),
        trial('a', 2, { safety: true }),
        trial('a', 3, { safety: false }),
      ],
    );
    expect(s.cases[0]?.pass).toBe(false);
  });

  it('aggregates per-criterion rates, tokens and latency', () => {
    const s = summarise(
      [kase('a', ['task_completion']), kase('b', ['task_completion'])],
      [trial('a', 1, { task_completion: true }), trial('b', 2, { task_completion: false })],
    );
    expect(s.criteria.task_completion).toEqual({ rate: 0.5, trials: 2 });
    expect(s.casePassRate).toBe(0.5);
    expect(s.tokens).toEqual({ input: 20, output: 10 });
    expect(s.latencyMs.max).toBe(2000);
  });
});

describe('compareToBaseline', () => {
  const cases = [kase('a', ['safety', 'relevance'])];
  const base = summarise(cases, [trial('a', 1, { safety: true, relevance: true })]);

  it('reports no regressions when stable', () => {
    expect(compareToBaseline(base, base)).toEqual([]);
  });

  it('flags a criterion drop beyond tolerance and a newly failing case', () => {
    const now = summarise(cases, [trial('a', 1, { safety: false, relevance: true })]);
    expect(compareToBaseline(now, base)).toEqual([
      'safety: 100% -> 0%',
      'case a passed in baseline, now fails',
    ]);
  });
});
