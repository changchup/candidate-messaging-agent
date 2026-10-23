import type {
  AssistantBlock,
  LlmClient,
  LlmRequest,
  LlmResponse,
  ToolResultBlock,
  ToolUseBlock,
} from './types.ts';

export type ScriptStep =
  AssistantBlock[] | Error | ((request: LlmRequest) => AssistantBlock[] | Error);

let nextId = 0;
export const toolUse = (name: string, input: unknown): ToolUseBlock => ({
  type: 'tool_use',
  id: `toolu_${++nextId}`,
  name,
  input,
});

const respond = (content: AssistantBlock[]): LlmResponse => ({
  content,
  stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  model: 'fake',
  usage: { inputTokens: 0, outputTokens: 0 },
});

/** Replays a fixed sequence of turns. Throws if the orchestrator asks for more turns than scripted. */
export function createScriptedLlm(steps: ScriptStep[]) {
  const requests: LlmRequest[] = [];
  const client: LlmClient & { requests: LlmRequest[] } = {
    requests,
    async complete(request) {
      requests.push(structuredClone(request));
      const step = steps.shift();
      if (step === undefined) throw new Error('ScriptedLlm: no more scripted steps');
      const value = typeof step === 'function' ? step(request) : step;
      if (value instanceof Error) throw value;
      return respond(value);
    },
  };
  return client;
}

/** Never answers; settles only when aborted, like a hung HTTP request. */
export function createHangingLlm(): LlmClient {
  return {
    complete: (_req, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  };
}

/**
 * Deterministic stand-in for the real model, used for LLM_MODE=fake (dev without a key,
 * browser tests, CI). Follows the same protocol as the real agent: fetch data, then submit
 * a templated draft or give up with cannot_draft.
 */
export function createTemplateLlm(): LlmClient {
  return {
    async complete(request) {
      const first = request.messages[0];
      const ask = JSON.parse(
        typeof first?.content === 'string' ? (first.content.split('\n')[1] ?? '{}') : '{}',
      ) as { candidateId: string; jobId: string };

      const results = new Map<string, ToolResultBlock>();
      const calls = new Map<string, ToolUseBlock>();
      for (const m of request.messages) {
        if (typeof m.content === 'string') continue;
        for (const b of m.content) {
          if (b.type === 'tool_use') calls.set(b.id, b);
          if (b.type === 'tool_result') results.set(calls.get(b.tool_use_id)?.name ?? '', b);
        }
      }

      if (results.has('submit_draft')) {
        return respond([
          toolUse('cannot_draft', {
            reason: `Draft failed checks: ${results.get('submit_draft')?.content}`,
          }),
        ]);
      }

      const candidate = results.get('get_candidate');
      if (!candidate) {
        return respond([
          toolUse('get_candidate', { candidateId: ask.candidateId }),
          toolUse('get_job', { jobId: ask.jobId }),
        ]);
      }
      const c = JSON.parse(candidate.content) as { firstName: string; timezone: string };
      const slots = results.get('get_interview_slots');
      if (!slots) {
        return respond([
          toolUse('get_interview_slots', { jobId: ask.jobId, timezone: c.timezone }),
        ]);
      }

      const failed = [...results.values()].find((r) => r.is_error);
      if (failed)
        return respond([
          toolUse('cannot_draft', { reason: `A data lookup failed: ${failed.content}` }),
        ]);

      const job = JSON.parse(results.get('get_job')!.content) as {
        title: string;
        interviewFormat: string;
      };
      const open = (
        JSON.parse(slots.content) as { id: string; localStart: string; interviewer: string }[]
      ).slice(0, 3);
      if (open.length === 0) {
        return respond([
          toolUse('cannot_draft', {
            reason: `There are no open interview slots for the ${job.title} role.`,
          }),
        ]);
      }

      const body = [
        `Hi ${c.firstName},`,
        '',
        `Thank you for applying for the ${job.title} role. We'd love to invite you to a ${job.interviewFormat} interview. Please reply with the time that suits you best:`,
        '',
        ...open.map((s) => `- ${s.localStart} with ${s.interviewer}`),
        '',
        'Best regards,',
        'Talent Team',
      ].join('\n');
      return respond([
        toolUse('submit_draft', {
          subject: `Interview invitation: ${job.title}`,
          body,
          slotIds: open.map((s) => s.id),
          citedFacts: [
            `candidate.firstName=${c.firstName}`,
            `job.title=${job.title}`,
            ...open.map((s) => `slot ${s.id}`),
          ],
        }),
      ]);
    },
  };
}
