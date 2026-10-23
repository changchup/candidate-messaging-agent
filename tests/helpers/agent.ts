import { createOrchestrator, type OrchestratorOptions } from '../../src/agent/orchestrator.ts';
import type { LlmClient } from '../../src/agent/llm/types.ts';
import { silentLogger } from '../../src/observability/logger.ts';
import { openRunStore, type RunStore } from '../../src/state/run-store.ts';
import { createGetCandidate, createGetJob } from '../../src/tools/candidate-tools.ts';
import { createMockEmailProvider, createSendMessage } from '../../src/tools/email-provider.ts';
import { createGetInterviewSlots, createSlotSource } from '../../src/tools/slot-tools.ts';
import { fixedClock, fixtureRepository } from './fixtures.ts';

export function buildTestAgent(opts: {
  llm: LlmClient;
  emailStatus?: { current: 'up' | 'down' };
  slots?: 'valid' | 'malformed';
  store?: RunStore;
  options?: Partial<OrchestratorOptions>;
}) {
  const repository = fixtureRepository();
  const store = opts.store ?? openRunStore(':memory:', fixedClock);
  const emailStatus = opts.emailStatus ?? { current: 'up' };
  const provider = createMockEmailProvider({ status: () => emailStatus.current });
  let n = 0;
  const orchestrator = createOrchestrator({
    store,
    llm: opts.llm,
    repository,
    logger: silentLogger,
    newId: () => `run-${++n}`,
    tools: {
      getCandidate: createGetCandidate({ repository, now: fixedClock }),
      getJob: createGetJob({ repository }),
      getInterviewSlots: createGetInterviewSlots({
        slotSource: createSlotSource(repository, opts.slots ?? 'valid'),
        now: fixedClock,
      }),
    },
    sendMessage: createSendMessage({ provider }),
    options: opts.options,
  });
  return { orchestrator, store, provider, emailStatus, repository };
}
