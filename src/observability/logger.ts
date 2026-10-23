import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({ level, base: { service: 'candidate-messaging-agent' } });
}

/** Tests and evals use a silent logger; diagnostics live in the run event log. */
export const silentLogger: Logger = pino({ level: 'silent' });
