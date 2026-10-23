import { createAnthropicClient } from './agent/llm/anthropic-client.ts';
import { createTemplateLlm } from './agent/llm/fake-llm.ts';
import type { LlmClient } from './agent/llm/types.ts';
import { createOrchestrator } from './agent/orchestrator.ts';
import type { Config } from './config.ts';
import { loadDataset } from './data/dataset.ts';
import { createLogger, type Logger } from './observability/logger.ts';
import { openRunStore } from './state/run-store.ts';
import { createGetCandidate, createGetJob } from './tools/candidate-tools.ts';
import { createMockEmailProvider, createSendMessage } from './tools/email-provider.ts';
import { createGetInterviewSlots, createSlotSource } from './tools/slot-tools.ts';

/** Composition root: builds every dependency from config. Tests override pieces as needed. */
export function buildContext(config: Config, overrides: { llm?: LlmClient; logger?: Logger } = {}) {
  const logger = overrides.logger ?? createLogger(config.LOG_LEVEL);
  const now = config.CLOCK_NOW ? () => new Date(config.CLOCK_NOW!) : () => new Date();

  const { repository, reports } = loadDataset(config.DATA_DIR);
  for (const report of reports) {
    if (report.rejected.length) logger.warn({ report }, 'rejected rows in source data');
  }

  const llm =
    overrides.llm ??
    (config.LLM_MODE === 'fake'
      ? createTemplateLlm()
      : createAnthropicClient({ model: config.AGENT_MODEL, apiKey: config.ANTHROPIC_API_KEY }));

  const store = openRunStore(config.DB_PATH, now);
  // Mutable so operators/tests can simulate an outage at runtime.
  const emailStatus = { current: config.EMAIL_PROVIDER };
  const provider = createMockEmailProvider({ status: () => emailStatus.current });

  const orchestrator = createOrchestrator({
    store,
    llm,
    repository,
    logger,
    tools: {
      getCandidate: createGetCandidate({ repository, now }),
      getJob: createGetJob({ repository }),
      getInterviewSlots: createGetInterviewSlots({
        slotSource: createSlotSource(repository, config.SLOTS_SOURCE),
        now,
      }),
    },
    sendMessage: createSendMessage({ provider }),
    options: { llmTimeoutMs: config.LLM_TIMEOUT_MS },
  });

  return { config, logger, now, repository, reports, store, provider, emailStatus, orchestrator };
}

export type AppContext = ReturnType<typeof buildContext>;
