import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { registerAuth } from './auth.ts';
import { registerErrorHandler } from './errors.ts';
import { dataRoutes } from './routes/data.ts';
import { runRoutes } from './routes/runs.ts';

export function buildApp(ctx: AppContext, opts: { webDir?: string } = {}): FastifyInstance {
  const app = Fastify({ loggerInstance: ctx.logger as FastifyBaseLogger });

  registerErrorHandler(app);
  registerAuth(app, ctx.config.tokens);

  app.get('/api/health', async () => ({ status: 'ok', llmMode: ctx.config.LLM_MODE }));
  dataRoutes(app, ctx);
  runRoutes(app, ctx);

  const webDir = resolve(opts.webDir ?? 'dist/web');
  if (existsSync(webDir)) {
    app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.status(404).send({
            error: { code: 'NOT_FOUND', message: `No route ${request.method} ${request.url}` },
          })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
