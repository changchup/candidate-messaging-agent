/** Provider-neutral subset of the Messages API that the orchestrator depends on. */

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AssistantBlock = TextBlock | ToolUseBlock;

export type Message =
  | { role: 'user'; content: string | (TextBlock | ToolResultBlock)[] }
  | { role: 'assistant'; content: AssistantBlock[] };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxTokens: number;
}

export interface LlmResponse {
  content: AssistantBlock[];
  stopReason: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmClient {
  complete(request: LlmRequest, options: { signal: AbortSignal }): Promise<LlmResponse>;
}

/** Retryable: timeouts, rate limits, 5xx, connection resets. */
export class LlmTransientError extends Error {
  readonly kind: 'timeout' | 'unavailable';

  constructor(kind: 'timeout' | 'unavailable', message: string) {
    super(message);
    this.kind = kind;
  }
}
