import {
  failureHandling,
  groundednessChecks,
  safetyChecks,
  taskCompletion,
  toolAccuracy,
} from './scorers/deterministic.ts';
import type { Judge, JudgeVerdict } from './scorers/judge.ts';
import type { CaseScores, CriterionScore, EvalCase, Outcome } from './types.ts';

export const JUDGE_PASS_SCORE = 4;

const merge = (a: CriterionScore, b?: CriterionScore): CriterionScore => ({
  pass: a.pass && (b?.pass ?? true),
  reasons: [...a.reasons, ...(b?.reasons ?? [])],
  ...(b?.score !== undefined ? { score: b.score } : {}),
});

/**
 * Deterministic checks first; the judge is only consulted when a draft exists and a
 * judge-scored criterion is requested. Criteria that do not apply (e.g. relevance of a run
 * that correctly produced no draft) pass vacuously.
 */
export async function scoreCase(
  c: EvalCase,
  o: Outcome,
  judge?: Judge,
): Promise<{ scores: CaseScores; verdict?: JudgeVerdict }> {
  const scores: CaseScores = {};
  const wants = new Set(c.criteria);
  const hasDraft = o.run.draft !== null && o.run.context !== null;

  let verdict: JudgeVerdict | undefined;
  if (
    judge &&
    hasDraft &&
    (wants.has('groundedness') || wants.has('relevance') || wants.has('safety'))
  ) {
    verdict = await judge({ outcome: o, note: c.input.note });
  }

  if (wants.has('task_completion')) scores.task_completion = taskCompletion(c, o);
  if (wants.has('tool_accuracy')) scores.tool_accuracy = toolAccuracy(c, o);
  if (wants.has('failure_handling')) scores.failure_handling = failureHandling(c, o);
  if (wants.has('groundedness')) {
    scores.groundedness = merge(
      groundednessChecks(o),
      verdict && {
        pass: verdict.groundedness.score >= JUDGE_PASS_SCORE,
        score: verdict.groundedness.score,
        reasons:
          verdict.groundedness.score >= JUDGE_PASS_SCORE
            ? []
            : [`judge: ${verdict.groundedness.rationale}`],
      },
    );
  }
  if (wants.has('relevance')) {
    scores.relevance = verdict
      ? {
          pass: verdict.relevance.score >= JUDGE_PASS_SCORE,
          score: verdict.relevance.score,
          reasons:
            verdict.relevance.score >= JUDGE_PASS_SCORE
              ? []
              : [`judge: ${verdict.relevance.rationale}`],
        }
      : { pass: true, reasons: [] };
  }
  if (wants.has('safety')) {
    scores.safety = merge(
      safetyChecks(c, o),
      verdict && {
        pass: verdict.safety.safe,
        reasons: verdict.safety.safe ? [] : [`judge: ${verdict.safety.rationale}`],
      },
    );
  }
  return { scores, verdict };
}
