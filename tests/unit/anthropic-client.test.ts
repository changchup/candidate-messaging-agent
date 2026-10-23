import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { classify, createAnthropicClient } from '../../src/agent/llm/anthropic-client.ts';
import { LlmTransientError } from '../../src/agent/llm/types.ts';

const request = {
  system: 'sys',
  maxTokens: 100,
  messages: [{ role: 'user' as const, content: 'hello' }],
  tools: [{ name: 'get_job', description: 'd', inputSchema: { type: 'object', properties: {} } }],
};

describe('AnthropicClient', () => {
  it('maps requests and responses between the SDK and the internal format', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'claude-sonnet-5-5',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        { type: 'thinking', thinking: '...' },
        { type: 'text', text: 'Fetching' },
        { type: 'tool_use', id: 'tu_1', name: 'get_job', input: { jobId: 'j-001' } },
      ],
    });
    const client = createAnthropicClient({
      model: 'claude-sonnet-5-5',
      messages: { create } as never,
    });
    const signal = new AbortController().signal;

    const res = await client.complete(request, { signal });

    expect(create).toHaveBeenCalledWith(
      {
        model: 'claude-sonnet-5-5',
        max_tokens: 100,
        system: 'sys',
        messages: request.messages,
        tools: [
          { name: 'get_job', description: 'd', input_schema: { type: 'object', properties: {} } },
        ],
      },
      { signal },
    );
    expect(res).toEqual({
      model: 'claude-sonnet-5-5',
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5 },
      content: [
        { type: 'text', text: 'Fetching' },
        { type: 'tool_use', id: 'tu_1', name: 'get_job', input: { jobId: 'j-001' } },
      ],
    });
  });
});

describe('classify', () => {
  const headers = new Headers();

  it.each([
    ['rate limit', new Anthropic.RateLimitError(429, {}, 'slow down', headers), 'unavailable'],
    ['5xx', new Anthropic.InternalServerError(529, {}, 'overloaded', headers), 'unavailable'],
    ['connection', new Anthropic.APIConnectionError({ message: 'reset' }), 'unavailable'],
    ['timeout', new Anthropic.APIConnectionTimeoutError({ message: 'timed out' }), 'timeout'],
  ])('treats %s as transient', (_name, error, kind) => {
    const mapped = classify(error);
    expect(mapped).toBeInstanceOf(LlmTransientError);
    expect((mapped as LlmTransientError).kind).toBe(kind);
  });

  it('does not retry client errors', () => {
    const e = new Anthropic.BadRequestError(400, {}, 'bad', headers);
    expect(classify(e)).toBe(e);
  });
});
