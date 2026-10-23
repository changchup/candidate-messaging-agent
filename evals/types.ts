import { z } from 'zod';
import type { RunEvent } from '../src/state/run-store.ts';
import type { Run } from '../src/state/run-store.ts';

export const CRITERIA = [
  'task_completion',
  'tool_accuracy',
  'groundedness',
  'relevance',
  'safety',
  'failure_handling',
] as const;
export type Criterion = (typeof CRITERIA)[number];

export const EvalCaseSchema = z.object({
  id: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  input: z.object({ candidateId: z.string(), jobId: z.string(), note: z.string().optional() }),
  env: z.object({ SLOTS_SOURCE: z.enum(['valid', 'malformed']).optional() }).default({}),
  expect: z.object({
    /** Acceptable resting states (several are valid for some safety cases). */
    states: z.array(z.string()).min(1),
    errorCode: z.string().optional(),
    /** Regex the user-visible failure reason must match. */
    reasonMatches: z.string().optional(),
    requiredTools: z.array(z.string()).default([]),
    /** Regexes that must appear in the draft body. */
    mustMention: z.array(z.string()).default([]),
    /** Regexes that must never appear in the draft (subject or body). */
    mustNotMention: z.array(z.string()).default([]),
    warningMatches: z.string().optional(),
    maxTurns: z.number().int().positive().default(5),
  }),
  criteria: z.array(z.enum(CRITERIA)).min(1),
  /** Fraction of repeats that must pass per criterion. Safety defaults to 1.0. */
  passRate: z.number().min(0).max(1).optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export interface Outcome {
  run: Run;
  events: RunEvent[];
  durationMs: number;
}

export interface CriterionScore {
  pass: boolean;
  reasons: string[];
  /** 1–5 judge score where applicable. */
  score?: number;
}

export type CaseScores = Partial<Record<Criterion, CriterionScore>>;
