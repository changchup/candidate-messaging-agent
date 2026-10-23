# Spec: Candidate Messaging Agent

Status: **Approved 2026-10-23**
Source brief: Intuitive.AI Lab Assessment — Senior Platform Engineer (AI). Timebox 2–4h.

## Objective

A recruiter wants to send a personalised **interview invitation** to a candidate for a specific role. Today that means reading the candidate's profile, the job, and the interview calendar, then hand-writing an email. We build an AI agent that gathers that data via tools, drafts a grounded invitation, checks it, and **pauses for recruiter approval** before anything is sent.

The point of the exercise is less the feature than making it *trustworthy*: tests at every layer, data validation, an AI evaluation harness, injected failures, and visible diagnostics.

### User stories

1. As a recruiter, I pick a candidate and a job and click **Draft invite**; within seconds I see a draft email with proposed interview slots and the facts it was based on.
2. As a recruiter, I can **approve**, **edit then approve**, or **reject** the draft. Only approval sends.
3. As a recruiter, if something is wrong (stale candidate data, no slots, model failure, unsafe content) I see a clear status and reason — never a silent bad send.
4. As a viewer (read-only role), I can see candidates and run history but cannot create, approve, or send.
5. As an operator, I can inspect a run's full step history (tool calls, inputs/outputs, guardrail results, timings, errors).

### Acceptance criteria

- The agent calls tools (`get_candidate`, `get_job`, `get_interview_slots`) and submits a structured draft via `submit_draft`.
- **The LLM cannot send.** `send_message` is invoked only by the orchestrator after a human approval API call.
- Run state is persisted per step; a run in `awaiting_approval` survives a server restart.
- Drafts that fail guardrails (ungrounded slot, protected-characteristic content, wrong candidate name, mention of salary not in job data) are blocked or flagged, not offered for one-click send.
- Stale candidate data (`updated_at` older than 90 days) is surfaced as a warning on the draft.
- All 5 injected failures below produce a visible, safe terminal or recoverable state.

## Agent design

### State machine

```
created → gathering → drafting → checking → awaiting_approval ─approve→ sending → sent
                                     │               └─reject→ rejected
                                     └─ guardrail block → blocked
any state ── unrecoverable error / step limit / timeout ──→ failed
sending ── send tool unavailable ──→ send_failed (retryable via approve)
```

- **Orchestrator** owns state transitions; the LLM only chooses tool calls within `gathering/drafting`.
- Step limit: 8 LLM turns. LLM call timeout: 20s, 1 retry on transient errors (429/5xx/timeout).
- Every transition and tool call is appended to a `run_events` table (the execution history).

### Tools

| Tool | Caller | Purpose |
|---|---|---|
| `get_candidate(candidateId)` | LLM | Validated candidate profile + staleness flag |
| `get_job(jobId)` | LLM | Validated job details |
| `get_interview_slots(jobId)` | LLM | Open slots in the future only |
| `submit_draft({subject, body, slotIds, citedFacts})` | LLM | Terminates drafting; schema-validated |
| `send_message({to, subject, body})` | Orchestrator only | Mock email provider (can be made to fail) |

Tool results are zod-validated; an invalid tool response is returned to the LLM as a structured error, and counts toward the step limit.

### Guardrails (deterministic, in `checking`)

- Every `slotId` exists, belongs to the job, and is in the future.
- Candidate first name in body matches the record; no other candidate's name appears.
- No protected-characteristic language (age, family/pregnancy, religion, nationality, health, etc. — keyword + pattern list).
- No compensation figures unless present in job data.
- Unsafe *requests* (e.g. recruiter note asking to probe family plans) → `blocked` with reason.

### Injected failures (toggled via env/fixture, all tested)

1. **Stale data** — candidate `updated_at` > 90 days → warning on draft.
2. **Malformed input** — bad CSV rows rejected at load with a validation report; API rejects malformed request bodies (400).
3. **Unavailable dependency** — `send_message` provider down → `send_failed`, retryable.
4. **Invalid tool response** — slot service returns malformed data → LLM gets structured error; run fails cleanly if unrecoverable.
5. **LLM timeout** — → retry once, then `failed` with reason.

## Tech Stack

- Node 24, TypeScript 5 (strict), ESM
- API: Fastify 5, zod for all schemas
- Agent: `@anthropic-ai/sdk`, hand-rolled orchestrator. Agent model `claude-sonnet-5-5`; eval judge `claude-haiku-5-5`
- State: SQLite via built-in `node:sqlite` (no native build step)
- Data source: CSV fixtures (ATS-export shape) parsed with `csv-parse`
- UI: React + Vite (single page), served by Fastify in production build
- Logs: pino (JSON, `runId` on every line)
- Tests: Vitest (unit/integration/API/data), Playwright (browser), custom eval runner

## API

All routes require `Authorization: Bearer <token>`. Tokens map to roles in config (`recruiter`, `viewer`).

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/health` | none | liveness |
| GET | `/api/candidates` | viewer+ | validated, presented list |
| GET | `/api/jobs` | viewer+ | |
| POST | `/api/runs` | recruiter | `{candidateId, jobId, note?}` → runs agent to `awaiting_approval`/`blocked`/`failed` |
| GET | `/api/runs/:id` | viewer+ | state, draft, warnings, events |
| POST | `/api/runs/:id/approve` | recruiter | `{subject?, body?}` (edits re-run guardrails) → send |
| POST | `/api/runs/:id/reject` | recruiter | `{reason}` |

Errors use one shape: `{ error: { code, message, details? } }`. 401 missing/invalid token, 403 wrong role, 404 unknown id, 409 invalid state transition, 400 validation.

## Commands

```
Install:      npm install
Dev:          npm run dev              # API :3000 + Vite :5173, LLM_MODE=real
Dev (no key): LLM_MODE=fake npm run dev
Build:        npm run build
Typecheck:    npm run typecheck
Lint:         npm run lint
Unit+int+API+data: npm test            # Vitest, fake LLM, no network
Coverage:     npm test -- --coverage
Browser:      npm run test:e2e         # Playwright, fake LLM
Evals:        npm run eval             # real model, needs ANTHROPIC_API_KEY
Evals (smoke):npm run eval -- --tag smoke --repeats 1
```

## Project Structure

```
src/
  domain/        → types + zod schemas (Candidate, Job, Slot, Draft, Run)
  data/          → CSV loaders, validation report, repositories
  tools/         → tool definitions + handlers (pure, injectable deps)
  agent/         → orchestrator state machine, LLM client interface, prompts, guardrails
    llm/         → AnthropicClient, FakeLLM (scripted)
  state/         → SQLite run + event store
  api/           → Fastify app, routes, auth plugin, error handler
  observability/ → logger, run event recorder
  web/           → React UI
fixtures/data/   → candidates.csv, jobs.csv, slots.csv (+ malformed variants)
tests/
  unit/          → guardrails, schemas, state transitions, tools
  integration/   → orchestrator + FakeLLM + real SQLite + tools
  api/           → Fastify inject: success, validation, authz, failures
  data/          → CSV → domain → API presentation correctness
e2e/             → Playwright critical workflow
evals/
  dataset.jsonl  → eval cases
  scorers/       → deterministic + LLM-judge scorers
  run.ts         → runner → reports/
reports/         → committed representative test + eval output
.github/workflows/ci.yml
README.md, SPEC.md
```

## Code Style

Strict TS, no `any`, zod schemas as the source of truth for types, dependencies injected via plain objects (no DI framework), `Result`-style returns at tool boundaries.

```ts
export const SlotSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  startsAt: z.coerce.date(),
  durationMinutes: z.number().int().positive(),
});
export type Slot = z.infer<typeof SlotSchema>;

export function createGetInterviewSlots(deps: { slots: SlotRepository; now: () => Date }) {
  return async (input: { jobId: string }): Promise<ToolResult<Slot[]>> => {
    const slots = await deps.slots.findByJob(input.jobId);
    return ok(slots.filter((s) => s.startsAt > deps.now()));
  };
}
```

- Files `kebab-case.ts`; types `PascalCase`; functions `camelCase`.
- Clock, IDs, LLM, and email provider are always injected (deterministic tests).
- Prettier + ESLint defaults; conventional-ish commit messages (`feat:`, `test:`, `docs:`).

## Testing Strategy

Risk-based: most effort where a bug would send a wrong or harmful message.

| Level | Tool | Covers | LLM |
|---|---|---|---|
| Unit | Vitest | guardrails, schemas, state transitions, tool handlers, staleness | none |
| Integration | Vitest | orchestrator end-to-end with FakeLLM scripts incl. tool errors, step limit, timeout, restart persistence | fake |
| API | Vitest + `app.inject` | each route: success, 400, 401, 403, 404, 409, dependency failure | fake |
| Data validation | Vitest | CSV parsing, malformed row rejection report, normalisation (names, emails, timezones), API presentation matches source | none |
| Browser | Playwright | select candidate → draft → edit → approve → see "sent"; screenshot + trace on failure | fake |
| AI eval | custom runner | real-model behaviour on dataset | real |

No coverage % target; instead every guardrail and every state transition must have a test. All PR-level tests run offline and deterministically.

### AI evaluation

- **Dataset:** ~15 cases in `evals/dataset.jsonl`: happy paths, stale candidate, no slots, past-only slots, malformed slot tool response, unsafe recruiter note, prompt-injection in candidate notes field, ambiguous name, etc.
- **Criteria per case** (each case declares which apply):
  - *Task completion* — reached expected terminal state (deterministic).
  - *Tool accuracy* — required tools called with correct args; no forbidden calls (deterministic, from event log).
  - *Groundedness* — every factual claim traceable to tool output (deterministic slot/name checks + Haiku judge with rubric).
  - *Relevance* — it's an interview invite for this role/candidate, appropriate tone (judge, 1–5, pass ≥4).
  - *Safety* — no protected-characteristic content; injection ignored (deterministic + judge).
  - *Failure handling* — correct failure state and user-visible reason (deterministic).
- **Non-determinism:** each case runs N times (default 3); a case passes at ≥ its declared pass-rate (default 100% for safety cases, 2/3 otherwise). Report includes per-criterion pass rates and variance.
- **Regression:** `reports/eval-baseline.json` committed; runner flags any criterion dropping > 10pp vs baseline. Prompt and model ID are recorded in each report.

## CI/CD (documented + `.github/workflows/ci.yml`)

- **Pull request:** lint, typecheck, unit, integration, API, data, Playwright (all fake LLM; offline, fast, deterministic).
- **Deploy (main / pre-release):** all of the above + eval `smoke` subset against real model (repeats 1, safety cases must pass).
- **Scheduled (nightly/weekly):** full eval suite, repeats 5, compared to baseline; alerts on regressions; also run on any prompt or model-ID change.

## Boundaries

- **Always:** validate at every boundary with zod; inject clock/LLM/provider; log with `runId`; keep PR tests offline; commit in small meaningful steps; update SPEC.md when decisions change.
- **Ask first:** adding dependencies beyond the stack above; changing the state machine; expanding scope past interview invites; anything that pushes past ~4h.
- **Never:** commit API keys or `.env`; let the LLM trigger `send_message`; send real email; delete or weaken a failing test/eval to get green.

## Success Criteria

1. `npm install && npm test && npm run test:e2e` passes on a clean checkout with no API key.
2. `npm run eval` with a key produces `reports/eval-report.{json,md}` covering all six criteria, with repeats and pass rates.
3. Each of the 5 injected failures has at least one automated test asserting the safe/visible outcome.
4. Each API route has tests for success + validation + 401 + 403 + at least one failure path.
5. A browser test covers draft → edit → approve → sent, with trace/screenshot artifacts on failure.
6. A run's full event history is visible via API and in the UI.
7. README covers setup, architecture (with diagram), decisions, assumptions, test strategy, eval method, limitations, next steps, and CI mapping.
8. Public GitHub repo with incremental commit history.

## Out of Scope (documented as "with more time")

Real ATS/email integrations, real auth (OIDC), multiple message types, multi-tenant data, streaming UI, OpenTelemetry export, eval dashboards, red-team suite expansion, i18n.

## Decisions (resolved open questions)

1. Repo name: `candidate-messaging-agent` (public, under the user's GitHub account).
2. Representative test and real-model eval output is committed under `reports/`.
3. Time split: ~1h app+agent, ~1h tests, ~45m evals, ~30m docs/CI.
