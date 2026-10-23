import { z } from 'zod';

export const RoleSchema = z.enum(['recruiter', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODE: z.enum(['real', 'fake']).default('real'),
  AGENT_MODEL: z.string().default('claude-sonnet-5-5'),
  JUDGE_MODEL: z.string().default('claude-haiku-5-5'),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().default('./data/app.db'),
  DATA_DIR: z.string().default('./fixtures/data'),
  EMAIL_PROVIDER: z.enum(['up', 'down']).default('up'),
  SLOTS_SOURCE: z.enum(['valid', 'malformed']).default('valid'),
  AUTH_TOKENS: z.string().default('recruiter-token:recruiter,viewer-token:viewer'),
  LOG_LEVEL: z.string().default('info'),
  /** Pin "now" (ISO timestamp) for demos, browser tests and evals against fixture dates. */
  CLOCK_NOW: z.iso.datetime({ offset: true }).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type Config = z.infer<typeof ConfigSchema> & { tokens: Map<string, Role> };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse(env);
  const tokens = new Map<string, Role>();
  for (const pair of parsed.AUTH_TOKENS.split(',')) {
    const [token, role] = pair.split(':').map((s) => s.trim());
    if (token && role) tokens.set(token, RoleSchema.parse(role));
  }
  return { ...parsed, tokens };
}
