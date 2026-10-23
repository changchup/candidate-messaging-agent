// Manual smoke test against the real model: npx tsx --env-file=.env scripts/smoke-run.ts c-001 j-001
import { loadConfig } from '../src/config.ts';
import { buildContext } from '../src/context.ts';

const [candidateId = 'c-001', jobId = 'j-001', note = ''] = process.argv.slice(2);
const ctx = buildContext(
  loadConfig({
    ...process.env,
    DB_PATH: ':memory:',
    CLOCK_NOW: '2026-10-23T12:00:00Z',
    LOG_LEVEL: 'warn',
  }),
);
const run = await ctx.orchestrator.startRun({ candidateId, jobId, note, createdBy: 'smoke' });
console.log(
  JSON.stringify(
    {
      state: run.state,
      draft: run.draft,
      warnings: run.warnings,
      violations: run.violations,
      error: run.error,
    },
    null,
    2,
  ),
);
console.log(
  ctx.store
    .events(run.id)
    .map((e) => `${e.seq} ${e.type} ${JSON.stringify(e.data).slice(0, 160)}`)
    .join('\n'),
);
