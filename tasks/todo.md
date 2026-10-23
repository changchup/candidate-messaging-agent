# Tasks: Candidate Messaging Agent

See [`plan.md`](./plan.md) and [`../SPEC.md`](../SPEC.md). Each task ends with green tests and one commit.

## Phase A — Foundation

- [ ] **1. Scaffold project**
  - Acceptance: TS strict ESM project; Fastify app factory with `/api/health`; Vitest, ESLint, Prettier configured; `.env.example`, `.gitignore`.
  - Verify: `npm run typecheck && npm run lint && npm test` (health API test passes).
  - Files: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `src/api/app.ts`, `src/server.ts`, `tests/api/health.test.ts`

- [ ] **2. Domain schemas, CSV fixtures, loaders**
  - Acceptance: zod schemas for Candidate/Job/Slot/Draft; CSV loader returns `{records, rejected[{row, errors}]}`; normalises emails (lowercase/trim), names, ISO timestamps (UTC); malformed fixture rows rejected with reasons.
  - Verify: `npm test -- tests/data` — valid rows map exactly; each malformed variant rejected with expected reason.
  - Files: `src/domain/*.ts`, `src/data/csv-loader.ts`, `fixtures/data/{candidates,jobs,slots}.csv`, `fixtures/data/malformed-set/*.csv`, `tests/data/csv-loader.test.ts`

- [ ] **3. Repositories and tools**
  - Acceptance: in-memory repos from loaded data; `get_candidate` (adds `stale` flag at >90 days via injected clock), `get_job`, `get_interview_slots` (future only; malformed-source mode returns invalid payload), `send_message` mock provider (`up|down`); tool results are `ok|err` with codes.
  - Verify: `npm test -- tests/unit/tools`
  - Files: `src/data/repositories.ts`, `src/tools/*.ts`, `src/tools/email-provider.ts`, `tests/unit/tools.test.ts`

## Phase B — Agent core

- [ ] **4. Run store, event log, logger**
  - Acceptance: SQLite `runs` + `run_events`; create/get/update-state/append-event; illegal transitions throw; pino logger with `runId` child.
  - Verify: `npm test -- tests/unit/run-store` incl. reopen-db persistence test.
  - Files: `src/state/run-store.ts`, `src/state/transitions.ts`, `src/observability/logger.ts`, `tests/unit/run-store.test.ts`

- [ ] **5. Guardrails**
  - Acceptance: checks for slot validity, candidate name match / other-name leak, protected-characteristic terms, compensation not in job data, unsafe recruiter note; returns `{blocked, warnings[], violations[]}`.
  - Verify: `npm test -- tests/unit/guardrails` — one passing and one failing case per rule.
  - Files: `src/agent/guardrails.ts`, `tests/unit/guardrails.test.ts`

- [ ] **6. LLM interface, FakeLlm, orchestrator**
  - Acceptance: state machine per spec; tool dispatch with zod-validated args/results; 8-turn limit; 20s timeout + 1 retry; every step recorded as event; `approve/reject` methods with guardrail re-run on edits; `send_failed` retryable.
  - Verify: `npm test -- tests/integration` — happy path, stale warning, invalid tool response, LLM timeout→failed, step-limit→failed, unsafe note→blocked, email down→send_failed→retry→sent, restart while `awaiting_approval` then approve.
  - Files: `src/agent/llm/types.ts`, `src/agent/llm/fake-llm.ts`, `src/agent/orchestrator.ts`, `src/agent/tool-registry.ts`, `tests/integration/orchestrator.test.ts`

- [ ] **7. Prompts and AnthropicClient**
  - Acceptance: system prompt (tool data treated as untrusted data, cite facts, interview invite only); `AnthropicClient` maps tool calls; model IDs from config; selected via `LLM_MODE`.
  - Verify: unit test of request/response mapping with stubbed SDK; manual `LLM_MODE=real` single run if key present.
  - Files: `src/agent/prompts.ts`, `src/agent/llm/anthropic-client.ts`, `src/config.ts`, `tests/unit/anthropic-client.test.ts`

**Checkpoint B:** all integration tests green; commit; review orchestrator code before API work.

## Phase C — API

- [ ] **8. Auth, error handling, read routes, create run**
  - Acceptance: bearer auth plugin (roles), uniform error shape, `GET /candidates`, `GET /jobs`, `POST /runs`, `GET /runs/:id` (state, draft, warnings, events).
  - Verify: `npm test -- tests/api` — success, 400, 401, 403, 404, LLM failure → run `failed` returned with 200 + state.
  - Files: `src/api/auth.ts`, `src/api/errors.ts`, `src/api/routes/*.ts`, `tests/api/runs.test.ts`, `tests/api/read.test.ts`

- [ ] **9. Approve / reject routes**
  - Acceptance: approve (optional edits) and reject; 409 on wrong state; viewer 403; email down → `send_failed`.
  - Verify: `npm test -- tests/api/approval.test.ts`; data test asserting API candidate presentation matches CSV source.
  - Files: `src/api/routes/runs.ts`, `tests/api/approval.test.ts`, `tests/data/presentation.test.ts`

## Phase D — UX

- [ ] **10. React UI**
  - Acceptance: candidate + job pickers, Draft button, draft view (editable subject/body, slots, cited facts, warnings), Approve/Reject, status badge, event timeline; token entry stored in localStorage.
  - Verify: `npm run build`; manual check with `LLM_MODE=fake npm run dev`.
  - Files: `src/web/{index.html,main.tsx,App.tsx,api.ts,styles.css}`, `vite.config.ts`

- [ ] **11. Playwright critical-path test**
  - Acceptance: starts server with `LLM_MODE=fake` + temp DB; select candidate → draft → edit body → approve → "Sent" visible + timeline shows `send_message`; trace + screenshot on failure; HTML report.
  - Verify: `npm run test:e2e`
  - Files: `playwright.config.ts`, `e2e/invite.spec.ts`

## Phase E — Evaluation

- [ ] **12. Eval dataset and scorers**
  - Acceptance: ~15 cases in JSONL (happy, stale, no slots, past-only slots, malformed slots, unsafe note, prompt injection in notes, email down, etc.) with per-case criteria + pass-rate; deterministic scorers (completion, tool accuracy, failure handling, safety) and Haiku judge scorer (groundedness, relevance) with rubric.
  - Verify: `npm test -- tests/unit/scorers` (scorers tested against hand-made run fixtures).
  - Files: `evals/dataset.jsonl`, `evals/scorers/*.ts`, `tests/unit/scorers.test.ts`

- [ ] **13. Eval runner and reports**
  - Acceptance: `npm run eval [--tag] [--repeats]` runs cases against real model, writes `reports/eval-report.{json,md}` (per-criterion pass rate, variance, model+prompt hash), compares to `reports/eval-baseline.json`, exits non-zero on failure/regression.
  - Verify: run with key; commit report + baseline.
  - Files: `evals/run.ts`, `evals/report.ts`, `reports/*`

## Phase F — Ship

- [ ] **14. CI workflow**
  - Acceptance: GitHub Actions: PR job (lint, typecheck, test, e2e w/ artifacts); main job adds eval smoke (if secret present); scheduled weekly full eval.
  - Verify: workflow passes on GitHub after push.
  - Files: `.github/workflows/ci.yml`, `.github/workflows/eval-nightly.yml`

- [ ] **15. README, reports, publish**
  - Acceptance: README covers setup, architecture diagram, decisions, assumptions, test strategy, eval method, CI mapping, limitations, next steps; test report output committed; public repo `candidate-messaging-agent` created and pushed.
  - Verify: fresh clone → `npm install && npm test && npm run test:e2e` green with no key.
  - Files: `README.md`, `reports/test-summary.md`
