import { err, ok, type ToolResult } from './result.ts';

export interface OutgoingMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  send(message: OutgoingMessage): Promise<{ messageId: string }>;
}

export class ProviderUnavailableError extends Error {}

/** In-memory mock. `outbox` lets tests and the UI see what "would" have been sent. */
export function createMockEmailProvider(opts: { status: () => 'up' | 'down' }) {
  const outbox: (OutgoingMessage & { messageId: string })[] = [];
  const provider: EmailProvider & { outbox: typeof outbox } = {
    outbox,
    async send(message) {
      if (opts.status() === 'down')
        throw new ProviderUnavailableError('Email provider returned 503');
      const messageId = `msg-${outbox.length + 1}`;
      outbox.push({ ...message, messageId });
      return { messageId };
    },
  };
  return provider;
}

/** Only ever invoked by the orchestrator after human approval — never exposed to the LLM. */
export function createSendMessage(deps: { provider: EmailProvider }) {
  return async (message: OutgoingMessage): Promise<ToolResult<{ messageId: string }>> => {
    try {
      return ok(await deps.provider.send(message));
    } catch (e) {
      if (e instanceof ProviderUnavailableError) {
        return err('PROVIDER_UNAVAILABLE', e.message, true);
      }
      throw e;
    }
  };
}
