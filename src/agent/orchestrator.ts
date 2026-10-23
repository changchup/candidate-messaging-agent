import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DraftSchema, type Draft, type Job } from '../domain/schemas.ts';
import type { Repository } from '../data/dataset.ts';
import type { Logger } from '../observability/logger.ts';
import type { Run, RunError, RunStore } from '../state/run-store.ts';
import { InvalidTransitionError } from '../state/transitions.ts';
import type { CandidateView } from '../tools/candidate-tools.ts';
import type { createSendMessage } from '../tools/email-provider.ts';
import type { SlotView } from '../tools/slot-tools.ts';
import { checkDraft, checkRequest, type DraftContext } from './guardrails.ts';
import {
  LlmTransientError,
  type LlmClient,
  type LlmResponse,
  type Message,
  type ToolResultBlock,
  type ToolUseBlock,
} from './llm/types.ts';
import { SYSTEM_PROMPT, userPrompt } from './prompts.ts';
import {
  AGENT_TOOL_SPECS,
  CannotDraftInput,
  scopedDataTools,
  type DataTools,
} from './tool-registry.ts';

export interface OrchestratorOptions {
  maxTurns: number;
  llmTimeoutMs: number;
  llmRetries: number;
  /** How many times guardrail violations are fed back to the model before blocking. */
  maxRevisions: number;
  maxTokens: number;
}

export const DEFAULT_OPTIONS: OrchestratorOptions = {
  maxTurns: 8,
  llmTimeoutMs: 20_000,
  llmRetries: 1,
  maxRevisions: 1,
  maxTokens: 1024,
};

export interface OrchestratorDeps {
  store: RunStore;
  llm: LlmClient;
  tools: DataTools;
  sendMessage: ReturnType<typeof createSendMessage>;
  repository: Repository;
  logger: Logger;
  newId?: () => string;
  options?: Partial<OrchestratorOptions>;
}

/** Human edit rejected by guardrails; the run stays awaiting approval. */
export class DraftRejectedError extends Error {
  readonly violations: string[];

  constructor(violations: string[]) {
    super('Edited draft failed checks');
    this.violations = violations;
  }
}

export class InvalidDraftError extends Error {
  readonly issues: string;

  constructor(issues: string) {
    super('Edited draft is invalid');
    this.issues = issues;
  }
}

export interface StartRunInput {
  candidateId: string;
  jobId: string;
  note?: string;
  createdBy: string;
}

interface Gathered {
  candidate?: CandidateView;
  job?: Job;
  slots?: SlotView[];
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const opts = { ...DEFAULT_OPTIONS, ...deps.options };
  const { store } = deps;
  const newId = deps.newId ?? randomUUID;

  const fail = (runId: string, error: RunError) => {
    store.appendEvent(runId, 'error', { ...error });
    return store.transition(runId, 'failed', { error }, error.message);
  };

  async function callLlm(
    runId: string,
    turn: number,
    messages: Message[],
    log: Logger,
  ): Promise<LlmResponse> {
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      const signal = AbortSignal.timeout(opts.llmTimeoutMs);
      try {
        const res = await deps.llm.complete(
          { system: SYSTEM_PROMPT, messages, tools: AGENT_TOOL_SPECS, maxTokens: opts.maxTokens },
          { signal },
        );
        store.appendEvent(runId, 'llm_call', {
          turn,
          attempt,
          model: res.model,
          stopReason: res.stopReason,
          durationMs: Date.now() - started,
          usage: res.usage,
          text:
            res.content
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join('\n') || undefined,
          toolCalls: res.content.filter((b) => b.type === 'tool_use').map((b) => b.name),
        });
        return res;
      } catch (caught) {
        const e = signal.aborted
          ? new LlmTransientError('timeout', `no response within ${opts.llmTimeoutMs}ms`)
          : caught;
        const transient = e instanceof LlmTransientError;
        store.appendEvent(runId, 'llm_call', {
          turn,
          attempt,
          durationMs: Date.now() - started,
          error: e instanceof Error ? e.message : String(e),
          retryable: transient,
        });
        log.warn({ err: e, turn, attempt }, 'llm call failed');
        if (!transient || attempt > opts.llmRetries) throw e;
      }
    }
  }

  /** Runs the agent from `created` to a resting state: awaiting_approval, blocked or failed. */
  async function startRun(input: StartRunInput): Promise<Run> {
    const runId = newId();
    const log = deps.logger.child({ runId });
    store.create({
      id: runId,
      candidateId: input.candidateId,
      jobId: input.jobId,
      note: input.note ?? '',
      createdBy: input.createdBy,
    });
    log.info({ candidateId: input.candidateId, jobId: input.jobId }, 'run started');

    try {
      const precheck = checkRequest(input.note ?? '');
      if (precheck.violations.length) {
        store.appendEvent(runId, 'guardrail', { stage: 'request', ...precheck });
        return store.transition(
          runId,
          'blocked',
          { violations: precheck.violations },
          'unsafe request',
        );
      }

      store.transition(runId, 'gathering');
      const run = await agentLoop(runId, input, log);
      log.info({ state: run.state }, 'run resting');
      return run;
    } catch (e) {
      log.error({ err: e }, 'run failed');
      if (e instanceof LlmTransientError) {
        return fail(runId, {
          code: e.kind === 'timeout' ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE',
          message: `The language model did not respond (${e.message}). No draft was produced; try again later.`,
        });
      }
      return fail(runId, {
        code: 'INTERNAL_ERROR',
        message: e instanceof Error ? e.message : 'Unexpected error',
      });
    }
  }

  async function agentLoop(runId: string, input: StartRunInput, log: Logger): Promise<Run> {
    const callDataTool = scopedDataTools(deps.tools, input);
    const gathered: Gathered = {};
    const messages: Message[] = [
      { role: 'user', content: userPrompt({ ...input, note: input.note ?? '' }) },
    ];
    let revisions = 0;

    for (let turn = 1; turn <= opts.maxTurns; turn++) {
      const res = await callLlm(runId, turn, messages, log);
      messages.push({ role: 'assistant', content: res.content });

      const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) {
        messages.push({
          role: 'user',
          content: 'Continue by calling a tool. Finish with submit_draft or cannot_draft.',
        });
        continue;
      }

      const results: ToolResultBlock[] = [];
      for (const call of toolUses) {
        if (call.name === 'cannot_draft') {
          const parsed = CannotDraftInput.safeParse(call.input);
          const reason = parsed.success ? parsed.data.reason : 'Agent stopped without a reason';
          store.appendEvent(runId, 'tool_call', { tool: call.name, input: call.input, ok: true });
          return fail(runId, { code: 'CANNOT_DRAFT', message: reason });
        }

        if (call.name === 'submit_draft') {
          const outcome = handleSubmitDraft(runId, call, gathered, revisions);
          if ('run' in outcome) return outcome.run;
          if (outcome.revision) revisions++;
          results.push(outcome.result);
          continue;
        }

        const started = Date.now();
        const result = await callDataTool(call.name, call.input);
        store.appendEvent(runId, 'tool_call', {
          tool: call.name,
          input: call.input,
          ok: result.ok,
          durationMs: Date.now() - started,
          ...(result.ok ? { output: result.data } : { error: result.error }),
        });
        if (result.ok) {
          if (call.name === 'get_candidate') gathered.candidate = result.data as CandidateView;
          if (call.name === 'get_job') gathered.job = result.data as Job;
          if (call.name === 'get_interview_slots') gathered.slots = result.data as SlotView[];
        }
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result.ok ? result.data : { error: result.error }),
          ...(result.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: 'user', content: results });
    }

    return fail(runId, {
      code: 'STEP_LIMIT',
      message: `Agent did not finish within ${opts.maxTurns} model turns.`,
    });
  }

  function handleSubmitDraft(
    runId: string,
    call: ToolUseBlock,
    gathered: Gathered,
    revisions: number,
  ): { run: Run } | { result: ToolResultBlock; revision: boolean } {
    const reply = (content: string, revision = false) => ({
      result: { type: 'tool_result' as const, tool_use_id: call.id, content, is_error: true },
      revision,
    });

    const parsed = DraftSchema.safeParse(call.input);
    if (!parsed.success) {
      store.appendEvent(runId, 'tool_call', {
        tool: call.name,
        input: call.input,
        ok: false,
        error: 'invalid draft',
      });
      return reply(`Draft rejected: ${z.prettifyError(parsed.error)}`);
    }
    if (!gathered.candidate || !gathered.job || !gathered.slots) {
      store.appendEvent(runId, 'tool_call', {
        tool: call.name,
        input: call.input,
        ok: false,
        error: 'missing data',
      });
      return reply('Draft rejected: fetch the candidate, job and interview slots before drafting.');
    }

    const draft = parsed.data;
    const context: DraftContext = {
      candidate: gathered.candidate,
      job: gathered.job,
      slots: gathered.slots,
    };
    store.appendEvent(runId, 'tool_call', { tool: call.name, input: draft, ok: true });
    store.transition(runId, 'drafting', { draft, context: { ...context } });
    store.transition(runId, 'checking');

    const check = checkDraft(draft, context, {
      otherCandidateNames: otherNames(gathered.candidate.id),
    });
    store.appendEvent(runId, 'guardrail', { stage: 'draft', revision: revisions, ...check });

    if (check.violations.length === 0) {
      return {
        run: store.transition(runId, 'awaiting_approval', {
          warnings: check.warnings,
          violations: [],
        }),
      };
    }
    if (revisions < opts.maxRevisions) {
      store.transition(
        runId,
        'gathering',
        { violations: check.violations },
        'revising after failed checks',
      );
      return reply(
        `Draft failed automated checks. Fix these and resubmit:\n- ${check.violations.join('\n- ')}`,
        true,
      );
    }
    return {
      run: store.transition(
        runId,
        'blocked',
        { violations: check.violations, warnings: check.warnings },
        'draft failed checks after revision',
      ),
    };
  }

  function otherNames(candidateId: string) {
    return deps.repository
      .listCandidates()
      .filter((c) => c.id !== candidateId)
      .map((c) => `${c.firstName} ${c.lastName}`);
  }

  function requireRun(runId: string): Run {
    const run = store.get(runId);
    if (!run) throw new RunNotFoundError(runId);
    return run;
  }

  /** Human approval (optionally with edits). The only path to send_message. */
  async function approve(
    runId: string,
    input: { subject?: string; body?: string; actor: string },
  ): Promise<Run> {
    const run = requireRun(runId);
    if (run.state !== 'awaiting_approval' && run.state !== 'send_failed') {
      throw new InvalidTransitionError(run.state, 'sending');
    }
    if (!run.draft || !run.context) throw new Error(`Run ${runId} has no draft`);
    const context = run.context as unknown as DraftContext;

    let draft: Draft = run.draft;
    const edited = input.subject !== undefined || input.body !== undefined;
    if (edited) {
      const parsed = DraftSchema.safeParse({ ...run.draft, ...pickDefined(input) });
      if (!parsed.success) throw new InvalidDraftError(z.prettifyError(parsed.error));
      draft = parsed.data;
      const check = checkDraft(draft, context, {
        otherCandidateNames: otherNames(context.candidate.id),
      });
      store.appendEvent(runId, 'guardrail', { stage: 'human_edit', ...check });
      if (check.violations.length) throw new DraftRejectedError(check.violations);
      store.update(runId, { draft, warnings: check.warnings });
    }

    store.appendEvent(runId, 'human_action', { action: 'approve', actor: input.actor, edited });
    store.transition(runId, 'sending', { error: null });

    const started = Date.now();
    const to = context.candidate.email;
    const result = await deps.sendMessage({ to, subject: draft.subject, body: draft.body });
    store.appendEvent(runId, 'tool_call', {
      tool: 'send_message',
      input: { to, subject: draft.subject },
      ok: result.ok,
      durationMs: Date.now() - started,
      ...(result.ok ? { output: result.data } : { error: result.error }),
    });
    if (result.ok) return store.transition(runId, 'sent', { messageId: result.data.messageId });
    return store.transition(
      runId,
      'send_failed',
      {
        error: {
          code: result.error.code,
          message: `${result.error.message}. The draft is saved; approve again to retry.`,
        },
      },
      result.error.message,
    );
  }

  function reject(runId: string, input: { reason: string; actor: string }): Run {
    const run = requireRun(runId);
    if (run.state !== 'awaiting_approval' && run.state !== 'send_failed') {
      throw new InvalidTransitionError(run.state, 'rejected');
    }
    store.appendEvent(runId, 'human_action', {
      action: 'reject',
      actor: input.actor,
      reason: input.reason,
    });
    return store.transition(runId, 'rejected', {}, input.reason);
  }

  return { startRun, approve, reject };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} not found`);
  }
}

function pickDefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([k, v]) => v !== undefined && k !== 'actor'),
  ) as Partial<T>;
}
