import { buildApp } from './api/app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = buildApp({ logger: { level: config.LOG_LEVEL } });
await app.listen({ port: config.PORT, host: '0.0.0.0' });
