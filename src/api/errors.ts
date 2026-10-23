import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DraftRejectedError, InvalidDraftError, RunNotFoundError } from '../agent/orchestrator.ts';
import { InvalidTransitionError } from '../state/transitions.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Request body is invalid',
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/** One error shape for every failure: { error: { code, message, details? } }. Internals never leak. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
      reply
        .status(status)
        .send({ error: { code, message, ...(details !== undefined ? { details } : {}) } });

    if (error instanceof HttpError)
      return send(error.status, error.code, error.message, error.details);
    if (error instanceof RunNotFoundError) return send(404, 'NOT_FOUND', error.message);
    if (error instanceof InvalidTransitionError) {
      return send(409, 'INVALID_STATE', `Run is ${error.from}; this action is not allowed`);
    }
    if (error instanceof DraftRejectedError) {
      return send(
        422,
        'DRAFT_REJECTED',
        'Edited draft failed safety and grounding checks',
        error.violations,
      );
    }
    if (error instanceof InvalidDraftError)
      return send(400, 'VALIDATION_ERROR', error.message, error.issues);
    if ('statusCode' in error && error.statusCode && error.statusCode < 500) {
      return send(error.statusCode, error.code ?? 'BAD_REQUEST', error.message);
    }
    request.log.error({ err: error }, 'unhandled error');
    return send(500, 'INTERNAL_ERROR', 'Something went wrong');
  });
}
