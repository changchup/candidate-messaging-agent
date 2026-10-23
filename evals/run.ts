/**
 * Runs the eval dataset against the real model.
 *
 *   npm run eval                              # all cases, 3 repeats
 *   npm run eval -- --tag smoke --repeats 1   # quick deploy gate
 *   npm run eval -- --case happy-priya
 *   npm run eval -- --update-baseline
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PROMPT_VERSION } from '../src/agent/prompts.ts';
import { loadConfig } from '../src/config.ts';
import { buildContext } from '../src/context.ts';
import { silentLogger } from '../src/observability/logger.ts';
import { renderMarkdown, summarise, compareToBaseline, type Trial, type Report } from './report.ts';
import { scoreCase } from './score.ts';
import { createAnthropicJudge } from './scorers/judge.ts';
import { EvalCaseSchema, type EvalCase } from './types.ts';

const { values: args } = parseArgs({
  options: {
    tag: { type: 'string' },
    case: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string', default: 'reports' },
    baseline: { type: 'string', default: 'reports/eval-baseline.json' },
    'update-baseline': { type: 'boolean', default: false },
    'no-judge': { type: 'boolean', default: false },
  },
});

const FIXED_NOW = '2026-10-23T12:00:00Z';
const config = loadConfig({
  ...process.env,
  LLM_MODE: 'real',
  DB_PATH: ':memory:',
  CLOCK_NOW: FIXED_NOW,
});
if (!config.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required for evals.');
  process.exit(2);
}

const cases = readFileSync('evals/dataset.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((line) => EvalCaseSchema.parse(JSON.parse(line)))
  .filter((c) => (args.tag ? c.tags.includes(args.tag) : true))
  .filter((c) => (args.case ? c.id === args.case : true));

const repeats = Number(args.repeats);
const judge = args['no-judge']
  ? undefined
  : createAnthropicJudge({ model: config.JUDGE_MODEL, apiKey: config.ANTHROPIC_API_KEY });

async function runTrial(c: EvalCase, repeat: number): Promise<Trial> {
  // Fresh context per trial: isolated DB, per-case fault injection.
  const ctx = buildContext({ ...config, ...c.env }, { logger: silentLogger });
  const started = Date.now();
  try {
    const run = await ctx.orchestrator.startRun({ ...c.input, createdBy: 'eval' });
    const outcome = { run, events: ctx.store.events(run.id), durationMs: Date.now() - started };
    const { scores, verdict } = await scoreCase(c, outcome, judge);
    const usage = outcome.events
      .filter((e) => e.type === 'llm_call' && e.data.usage)
      .reduce(
        (acc, e) => {
          const u = e.data.usage as { inputTokens: number; outputTokens: number };
          return { input: acc.input + u.inputTokens, output: acc.output + u.outputTokens };
        },
        { input: 0, output: 0 },
      );
    return {
      caseId: c.id,
      repeat,
      state: run.state,
      durationMs: outcome.durationMs,
      tokens: usage,
      turns: outcome.events.filter((e) => e.type === 'llm_call' && !e.data.error).length,
      scores,
      verdict,
      draft: run.draft,
      error: run.error,
      warnings: run.warnings,
      violations: run.violations,
    };
  } catch (e) {
    return {
      caseId: c.id,
      repeat,
      state: 'harness_error',
      durationMs: Date.now() - started,
      tokens: { input: 0, output: 0 },
      turns: 0,
      scores: Object.fromEntries(
        c.criteria.map((k) => [k, { pass: false, reasons: [`harness error: ${String(e)}`] }]),
      ),
      error: { code: 'HARNESS_ERROR', message: String(e) },
      draft: null,
      warnings: [],
      violations: [],
    };
  } finally {
    ctx.store.close();
  }
}

async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]!();
        process.stdout.write('.');
      }
    }),
  );
  process.stdout.write('\n');
  return results;
}

console.log(
  `Running ${cases.length} cases x ${repeats} repeats (agent ${config.AGENT_MODEL}, judge ${judge ? config.JUDGE_MODEL : 'off'}, prompt ${PROMPT_VERSION})`,
);
const started = Date.now();
const trials = await pool(
  cases.flatMap((c) => Array.from({ length: repeats }, (_, r) => () => runTrial(c, r + 1))),
  Number(args.concurrency),
);

const summary = summarise(cases, trials);
const baselinePath = args.baseline;
let baseline: Report['summary'] | undefined;
try {
  baseline = (JSON.parse(readFileSync(baselinePath, 'utf8')) as Report).summary;
} catch {
  baseline = undefined;
}

const report: Report = {
  meta: {
    generatedAt: new Date().toISOString(),
    agentModel: config.AGENT_MODEL,
    judgeModel: judge ? config.JUDGE_MODEL : null,
    promptVersion: PROMPT_VERSION,
    repeats,
    filter: { tag: args.tag ?? null, case: args.case ?? null },
    wallClockMs: Date.now() - started,
  },
  summary,
  // Subset runs (--tag/--case) compare per case only; criterion rates over a subset are not comparable.
  regressions: baseline
    ? compareToBaseline(summary, baseline, { caseLevelOnly: Boolean(args.tag || args.case) })
    : [],
  trials,
};

mkdirSync(args.out, { recursive: true });
writeFileSync(`${args.out}/eval-report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${args.out}/eval-report.md`, renderMarkdown(report, cases));
const harnessErrors = trials.filter((t) => t.state === 'harness_error').length;
if (args['update-baseline']) {
  // A baseline must reflect model behaviour, never a broken harness run.
  if (harnessErrors) console.error(`Not updating baseline: ${harnessErrors} harness error(s).`);
  else writeFileSync(baselinePath, JSON.stringify({ meta: report.meta, summary }, null, 2));
}

console.log(renderMarkdown(report, cases).split('\n## Trials')[0]);
const failed = summary.cases.filter((c) => !c.pass).length;
if (failed || report.regressions.length) {
  console.error(
    `\n${failed} case(s) failed; ${report.regressions.length} regression(s) vs baseline.`,
  );
  process.exit(1);
}
