import Anthropic from '@anthropic-ai/sdk';
import type { AssistantBlock, LlmClient, LlmRequest, LlmResponse } from './types.ts';
import { LlmTransientError } from './types.ts';

type MessagesApi = Pick<Anthropic['messages'], 'create'>;

export function createAnthropicClient(opts: {
  model: string;
  apiKey?: string;
  /** Injected in tests. */
  messages?: MessagesApi;
  temperature?: number;
}): LlmClient {
  // Retries are owned by the orchestrator so every attempt is visible in the run history.
  const messages = opts.messages ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }).messages;

  return {
    async complete(request: LlmRequest, { signal }): Promise<LlmResponse> {
      try {
        const res = await messages.create(
          {
            model: opts.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: request.messages as Anthropic.MessageParam[],
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          },
          { signal },
        );
        return {
          model: res.model,
          stopReason: res.stop_reason ?? 'unknown',
          usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
          content: res.content.flatMap((b): AssistantBlock[] => {
            if (b.type === 'text') return [{ type: 'text', text: b.text }];
            if (b.type === 'tool_use')
              return [{ type: 'tool_use', id: b.id, name: b.name, input: b.input }];
            return [];
          }),
        };
      } catch (e) {
        throw classify(e);
      }
    },
  };
}

/** Map SDK errors to the orchestrator's retry semantics. */
export function classify(e: unknown): unknown {
  if (e instanceof Anthropic.APIUserAbortError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError)
    return new LlmTransientError('timeout', e.message);
  if (e instanceof Anthropic.APIConnectionError)
    return new LlmTransientError('unavailable', e.message);
  if (e instanceof Anthropic.RateLimitError)
    return new LlmTransientError('unavailable', 'rate limited (429)');
  if (e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 500) {
    return new LlmTransientError('unavailable', `provider error (${e.status})`);
  }
  return e;
}
