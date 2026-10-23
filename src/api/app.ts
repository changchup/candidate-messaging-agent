import Fastify, { type FastifyInstance } from 'fastify';

export interface AppDeps {
  logger?: boolean | object;
}

export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  app.get('/api/health', async () => ({ status: 'ok' }));
  return app;
}
