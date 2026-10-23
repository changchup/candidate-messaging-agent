# Implementation Plan: Candidate Messaging Agent

Source of truth: [`SPEC.md`](../SPEC.md). Task list: [`todo.md`](./todo.md).

## Approach

Build bottom-up along the dependency graph, but deliver **vertical, testable slices**: every task ends with green tests and a commit. Determinism first — the FakeLLM, injected clock and mock email provider exist before the orchestrator, so all PR-level tests stay offline. The real Anthropic client and the eval harness come after the deterministic core is proven.

## Dependency graph

```
scaffold
   │
domain schemas ──► CSV loaders (+validation report)
   │                     │
   │               repositories
   │                     │
   ├────────► tools (get_candidate / get_job / get_interview_slots / send_message)
   │                     │
run store + events ──────┤
   │                     │
guardrails ──────────────┤
   │                     │
LLM interface + FakeLLM ─┴─► orchestrator (state machine)
                                 │
                 ┌───────────────┼──────────────────┐
                 ▼               ▼                  ▼
          API + auth      AnthropicClient       eval harness
                 │          + prompts                ▲
                 ▼               └───────────────────┘
               React UI
                 │
             Playwright
                 │
          CI + README + reports
```

## Phases and checkpoints

| Phase | Tasks | Checkpoint (must pass before continuing) |
|---|---|---|
| A. Foundation | 1–3 | `npm test` green; malformed CSV produces validation report; tools unit-tested |
| B. Agent core | 4–7 | Orchestrator integration tests green with FakeLLM for happy path + all 5 injected failures; restart persistence proven |
| C. API | 8–9 | API suite covers every route × {success, 400, 401, 403, 404/409, dependency failure} |
| D. UX | 10–11 | Playwright critical path green with trace/screenshot artifacts |
| E. Real model + evals | 12–13 | `npm run eval` produces report; baseline committed |
| F. Ship | 14–15 | CI green on GitHub; README complete; public repo pushed |

Time budget: A+B ≈ 1h15, C ≈ 30m, D ≈ 40m, E ≈ 45m, F ≈ 30m (≈ 3h40).

## Key design decisions

- **Orchestrator vs LLM responsibility.** The LLM loop only runs in `gathering/drafting` and ends when it calls `submit_draft`. All transitions, guardrails, approval and sending are deterministic code. This is the main "not a chatbot wrapper" point.
- **`LlmClient` interface** (`complete(messages, tools, {signal}) → {toolCalls | text}`) with two implementations: `AnthropicClient` and `FakeLlm` (scripted turns, can throw/timeout/return bad tool calls). Selected by `LLM_MODE`.
- **Synchronous run creation.** `POST /api/runs` runs the agent to a resting state (`awaiting_approval|blocked|failed`) before responding. Simpler than queue/polling; acceptable for the timebox and documented as a limitation.
- **Failure injection via dependency config**, not code branches: e.g. `EMAIL_PROVIDER=down`, `SLOTS_SOURCE=malformed`, fixture candidate with old `updated_at`, `FakeLlm` timeout script. Tests construct deps directly.
- **Event log is the diagnostics backbone.** The same `run_events` rows drive the UI timeline, API response, eval tool-accuracy scoring and debugging.
- **Single package**, Vite builds UI into `dist/web` served by Fastify; dev uses Vite proxy.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Timebox overrun | Phases ordered so a cut after D still ships a complete tested app; evals use small dataset; UI deliberately minimal |
| Real-model non-determinism breaks tests | Only `evals/` touch the real model; repeats + pass-rate thresholds; baseline comparison |
| LLM-judge unreliability | Deterministic checks carry tool accuracy/completion/failure/safety; judge used only for groundedness/relevance with explicit rubric, scores recorded with rationale |
| `node:sqlite` is experimental | Pinned Node 24; store isolated behind `RunStore` so swapping to better-sqlite3 is one file |
| Prompt injection via candidate notes | Tool output wrapped as data in prompt; eval case + guardrail for it |
| No API key available when evaluating the submission | Committed eval report; everything else runs with `LLM_MODE=fake` |

## Parallelisable work

After task 7: API (8–9), AnthropicClient (12) and eval dataset authoring (13) are independent. Executed sequentially by one agent here, but the boundaries allow it.
