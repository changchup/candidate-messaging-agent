import type { JudgeVerdict } from './scorers/judge.ts';
import { CRITERIA, type CaseScores, type Criterion, type EvalCase } from './types.ts';

export const DEFAULT_PASS_RATE = 2 / 3;
export const SAFETY_PASS_RATE = 1;
export const REGRESSION_TOLERANCE = 0.1;

export interface Trial {
  caseId: string;
  repeat: number;
  state: string;
  durationMs: number;
  tokens: { input: number; output: number };
  turns: number;
  scores: CaseScores;
  verdict?: JudgeVerdict;
  draft: { subject: string; body: string; slotIds: string[] } | null;
  error: { code: string; message: string } | null;
  warnings: string[];
  violations: string[];
}

export interface CaseSummary {
  id: string;
  pass: boolean;
  /** Per-criterion fraction of repeats that passed. */
  rates: Partial<Record<Criterion, number>>;
  thresholds: Partial<Record<Criterion, number>>;
  states: Record<string, number>;
  /** Some but not all repeats passed for at least one criterion. */
  flaky: boolean;
  meanJudge?: { groundedness?: number; relevance?: number };
}

export interface Summary {
  cases: CaseSummary[];
  /** Pass rate per criterion across all trials where it applies. */
  criteria: Partial<Record<Criterion, { rate: number; trials: number }>>;
  casePassRate: number;
  latencyMs: { p50: number; p95: number; max: number };
  tokens: { input: number; output: number };
}

export interface Report {
  meta: {
    generatedAt: string;
    agentModel: string;
    judgeModel: string | null;
    promptVersion: string;
    repeats: number;
    filter: { tag: string | null; case: string | null };
    wallClockMs: number;
  };
  summary: Summary;
  regressions: string[];
  trials: Trial[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

export function summarise(cases: EvalCase[], trials: Trial[]): Summary {
  const caseSummaries = cases.map((c): CaseSummary => {
    const ts = trials.filter((t) => t.caseId === c.id);
    const rates: CaseSummary['rates'] = {};
    const thresholds: CaseSummary['thresholds'] = {};
    for (const k of c.criteria) {
      rates[k] = ts.filter((t) => t.scores[k]?.pass).length / ts.length;
      thresholds[k] = k === 'safety' ? SAFETY_PASS_RATE : (c.passRate ?? DEFAULT_PASS_RATE);
    }
    const states: Record<string, number> = {};
    for (const t of ts) states[t.state] = (states[t.state] ?? 0) + 1;
    const g = mean(ts.flatMap((t) => (t.verdict ? [t.verdict.groundedness.score] : [])));
    const r = mean(ts.flatMap((t) => (t.verdict ? [t.verdict.relevance.score] : [])));
    return {
      id: c.id,
      pass: c.criteria.every((k) => (rates[k] ?? 0) >= (thresholds[k] ?? 1) - 1e-9),
      rates,
      thresholds,
      states,
      flaky: Object.values(rates).some((v) => v > 0 && v < 1),
      ...(g !== undefined || r !== undefined
        ? { meanJudge: { groundedness: g, relevance: r } }
        : {}),
    };
  });

  const criteria: Summary['criteria'] = {};
  for (const k of CRITERIA) {
    const applicable = trials.filter((t) => t.scores[k]);
    if (applicable.length) {
      criteria[k] = {
        rate: applicable.filter((t) => t.scores[k]!.pass).length / applicable.length,
        trials: applicable.length,
      };
    }
  }
  const durations = trials.map((t) => t.durationMs);
  return {
    cases: caseSummaries,
    criteria,
    casePassRate: caseSummaries.filter((c) => c.pass).length / Math.max(caseSummaries.length, 1),
    latencyMs: {
      p50: quantile(durations, 0.5),
      p95: quantile(durations, 0.95),
      max: Math.max(0, ...durations),
    },
    tokens: trials.reduce(
      (a, t) => ({ input: a.input + t.tokens.input, output: a.output + t.tokens.output }),
      { input: 0, output: 0 },
    ),
  };
}

/** Flags any criterion whose overall pass rate dropped more than the tolerance vs baseline. */
export function compareToBaseline(current: Summary, baseline: Summary): string[] {
  const out: string[] = [];
  for (const k of CRITERIA) {
    const now = current.criteria[k]?.rate;
    const before = baseline.criteria[k]?.rate;
    if (now !== undefined && before !== undefined && before - now > REGRESSION_TOLERANCE) {
      out.push(`${k}: ${pct(before)} -> ${pct(now)}`);
    }
  }
  for (const c of current.cases) {
    const prev = baseline.cases.find((b) => b.id === c.id);
    if (prev?.pass && !c.pass) out.push(`case ${c.id} passed in baseline, now fails`);
  }
  return out;
}

export function renderMarkdown(report: Report, cases: EvalCase[]): string {
  const { meta, summary } = report;
  const lines: string[] = [
    '# Eval report',
    '',
    `Generated ${meta.generatedAt} · agent \`${meta.agentModel}\` · judge \`${meta.judgeModel ?? 'off'}\` · prompt \`${meta.promptVersion}\` · ${meta.repeats} repeat(s) per case · ${Math.round(meta.wallClockMs / 1000)}s`,
    '',
    `**Cases passing: ${summary.cases.filter((c) => c.pass).length}/${summary.cases.length} (${pct(summary.casePassRate)})** · latency p50 ${(summary.latencyMs.p50 / 1000).toFixed(1)}s, p95 ${(summary.latencyMs.p95 / 1000).toFixed(1)}s · tokens in/out ${summary.tokens.input}/${summary.tokens.output}`,
    '',
    '## By criterion',
    '',
    '| Criterion | Pass rate | Trials |',
    '|---|---|---|',
    ...CRITERIA.filter((k) => summary.criteria[k]).map(
      (k) => `| ${k} | ${pct(summary.criteria[k]!.rate)} | ${summary.criteria[k]!.trials} |`,
    ),
    '',
    report.regressions.length
      ? `**Regressions vs baseline:**\n${report.regressions.map((r) => `- ${r}`).join('\n')}`
      : 'No regressions vs baseline.',
    '',
    '## By case',
    '',
    '| Case | Result | States | ' + CRITERIA.join(' | ') + ' | Judge G/R |',
    '|---|---|---|' + CRITERIA.map(() => '---').join('|') + '|---|',
    ...summary.cases.map((c) => {
      const cells = CRITERIA.map((k) =>
        c.rates[k] === undefined
          ? '–'
          : `${pct(c.rates[k]!)}${c.rates[k]! < c.thresholds[k]! ? ' ❌' : ''}`,
      );
      const judge = c.meanJudge
        ? `${c.meanJudge.groundedness?.toFixed(1) ?? '–'}/${c.meanJudge.relevance?.toFixed(1) ?? '–'}`
        : '–';
      const states = Object.entries(c.states)
        .map(([s, n]) => `${s}×${n}`)
        .join(', ');
      return `| ${c.id} | ${c.pass ? 'pass' : '**FAIL**'}${c.flaky ? ' (flaky)' : ''} | ${states} | ${cells.join(' | ')} | ${judge} |`;
    }),
    '',
    '## Trials',
    '',
  ];
  for (const c of cases) {
    const ts = report.trials.filter((t) => t.caseId === c.id);
    if (!ts.length) continue;
    lines.push(`### ${c.id}`, '', `_${c.description}_`, '');
    for (const t of ts) {
      const failures = Object.entries(t.scores).flatMap(([k, s]) =>
        s?.pass ? [] : (s?.reasons.map((r) => `${k}: ${r}`) ?? []),
      );
      lines.push(
        `- **#${t.repeat}** ${t.state} · ${t.turns} turns · ${(t.durationMs / 1000).toFixed(1)}s${failures.length ? ` · ❌ ${failures.join('; ')}` : ''}`,
      );
      if (t.error) lines.push(`  - reason: ${t.error.message}`);
      if (t.violations.length) lines.push(`  - violations: ${t.violations.join('; ')}`);
    }
    const sample = ts.find((t) => t.draft);
    if (sample?.draft) {
      lines.push(
        '',
        '<details><summary>Sample draft</summary>',
        '',
        '```',
        `Subject: ${sample.draft.subject}`,
        '',
        sample.draft.body,
        '```',
        '</details>',
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
