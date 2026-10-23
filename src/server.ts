import { buildApp } from './api/app.ts';
import { loadConfig } from './config.ts';
import { buildContext } from './context.ts';

const config = loadConfig();
if (config.LLM_MODE === 'real' && !config.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to .env or run with LLM_MODE=fake.');
  process.exit(1);
}
const ctx = buildContext(config);
const app = buildApp(ctx);

const shutdown = async () => {
  await app.close();
  ctx.store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
