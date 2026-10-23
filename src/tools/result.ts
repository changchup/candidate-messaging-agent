export type ToolErrorCode =
  'NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_UPSTREAM_RESPONSE' | 'PROVIDER_UNAVAILABLE';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError };

export const ok = <T>(data: T): ToolResult<T> => ({ ok: true, data });
export const err = (
  code: ToolErrorCode,
  message: string,
  retryable = false,
): ToolResult<never> => ({
  ok: false,
  error: { code, message, retryable },
});
