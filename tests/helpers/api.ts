import { buildApp } from '../../src/api/app.ts';
import type { LlmClient } from '../../src/agent/llm/types.ts';
import { loadConfig } from '../../src/config.ts';
import { buildContext } from '../../src/context.ts';
import { silentLogger } from '../../src/observability/logger.ts';

export const RECRUITER = { authorization: 'Bearer recruiter-token' };
export const VIEWER = { authorization: 'Bearer viewer-token' };

export function buildTestApi(opts: { llm?: LlmClient; env?: Record<string, string> } = {}) {
  const config = loadConfig({
    LLM_MODE: 'fake',
    DB_PATH: ':memory:',
    CLOCK_NOW: '2026-10-23T12:00:00Z',
    ...opts.env,
  });
  const ctx = buildContext(config, { llm: opts.llm, logger: silentLogger });
  const app = buildApp(ctx, { webDir: '/nonexistent' });
  return { app, ctx };
}
