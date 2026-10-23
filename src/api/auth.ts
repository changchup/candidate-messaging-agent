import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Role } from '../config.ts';
import { HttpError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: { role: Role; actor: string };
  }
}

/**
 * Static bearer tokens mapped to roles. A stand-in for OIDC: the route-level role checks are
 * what matter and would stay the same with a real identity provider.
 */
export function registerAuth(app: FastifyInstance, tokens: Map<string, Role>) {
  app.decorateRequest('user', null as unknown as FastifyRequest['user']);
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || request.url === '/api/health') return;
    const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
    const role = match?.[1] ? tokens.get(match[1]) : undefined;
    if (!role) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing or invalid bearer token');
    request.user = { role, actor: role };
  });
}

export function requireRole(role: Role) {
  return async (request: FastifyRequest) => {
    if (request.user.role !== role) {
      throw new HttpError(403, 'FORBIDDEN', `This action requires the ${role} role`);
    }
  };
}
