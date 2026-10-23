# Test summary

Generated 2026-10-23T20:56:21Z on v24.14.1. All suites run offline with the fake LLM.

## Unit, integration, API and data-validation tests (Vitest)

```
 ✓ tests/unit/guardrails.test.ts > checkDraft > passes a grounded, safe draft 8ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks slots that are not available for the job 2ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks a draft that does not address the candidate by name 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks a draft that leaks another candidate name 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks protected topic: Do you have family plans in the next year? 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks protected topic: Please confirm your date of birth. 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks protected topic: Let us know about your religion so we can schedule. 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks protected topic: What is your nationality? 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks protected topic: Do you have any medical condition we should know about? 1ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > does not flag ordinary words that contain protected substrings 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > allows compensation that matches the published range 3ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks compensation that is not in the published range 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks any compensation when the job has no published range 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > blocks unfilled template placeholders 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > warns (but does not block) when the candidate data is stale 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft > warns when the role title is missing 0ms
 ✓ tests/unit/guardrails.test.ts > checkRequest > accepts a normal recruiter note 0ms
 ✓ tests/unit/guardrails.test.ts > checkRequest > blocks a note asking to probe protected topics 0ms
 ✓ tests/unit/guardrails.test.ts > checkDraft: declined requests must not leak to the candidate > blocks a draft that explains a declined discriminatory note in the email 0ms
 ✓ tests/unit/scorers.test.ts > dataset > every case in evals/dataset.jsonl is valid and ids are unique 4ms
 ✓ tests/unit/scorers.test.ts > taskCompletion > passes when state and mentions match 1ms
 ✓ tests/unit/scorers.test.ts > taskCompletion > fails on unexpected state 0ms
 ✓ tests/unit/scorers.test.ts > taskCompletion > fails when a required mention is missing 0ms
 ✓ tests/unit/scorers.test.ts > taskCompletion > fails when an expected warning is absent 0ms
 ✓ tests/unit/scorers.test.ts > toolAccuracy > passes for the expected tool sequence 0ms
 ✓ tests/unit/scorers.test.ts > toolAccuracy > fails if a required tool was skipped 0ms
 ✓ tests/unit/scorers.test.ts > toolAccuracy > fails if slots were not requested in the candidate timezone 0ms
 ✓ tests/unit/scorers.test.ts > toolAccuracy > fails if the wrong candidate was fetched 1ms
 ✓ tests/unit/scorers.test.ts > toolAccuracy > fails if too many model turns were used 0ms
 ✓ tests/unit/scorers.test.ts > groundednessChecks > passes when times and slots match fetched data 0ms
 ✓ tests/unit/scorers.test.ts > groundednessChecks > flags invented times 0ms
 ✓ tests/unit/scorers.test.ts > groundednessChecks > flags slot ids not returned by tools 0ms
 ✓ tests/unit/scorers.test.ts > groundednessChecks > flags slot ids whose time is missing from the body 0ms
 ✓ tests/unit/scorers.test.ts > groundednessChecks > flags salary when none is published 0ms
 ✓ tests/unit/scorers.test.ts > safetyChecks > flags protected topics and forbidden patterns 1ms
 ✓ tests/unit/scorers.test.ts > failureHandling > passes for a failed run with a matching reason 0ms
 ✓ tests/unit/scorers.test.ts > failureHandling > fails when the reason does not explain the problem 0ms
 ✓ tests/unit/scorers.test.ts > failureHandling > fails if anything was sent 0ms
 ✓ tests/unit/scorers.test.ts > scoreCase > combines deterministic checks with judge scores 2ms
 ✓ tests/unit/scorers.test.ts > scoreCase > judge safety failure fails safety even if regexes pass 1ms
 ✓ tests/unit/scorers.test.ts > scoreCase > does not call the judge when there is no draft 1ms
 ✓ tests/unit/run-store.test.ts > RunStore > creates runs in the created state with an initial event 4ms
 ✓ tests/unit/run-store.test.ts > RunStore > applies allowed transitions with patches and records them 1ms
 ✓ tests/unit/run-store.test.ts > RunStore > rejects illegal transitions and leaves state untouched 1ms
 ✓ tests/unit/run-store.test.ts > RunStore > does not allow leaving a terminal state 0ms
 ✓ tests/unit/run-store.test.ts > RunStore > persists runs and events across reopen (server restart) 7ms
 ✓ tests/unit/tools.test.ts > get_candidate > returns a fresh candidate with stale=false 4ms
 ✓ tests/unit/tools.test.ts > get_candidate > flags candidates not updated for more than 90 days as stale 0ms
 ✓ tests/unit/tools.test.ts > get_candidate > returns NOT_FOUND for unknown ids 0ms
 ✓ tests/unit/tools.test.ts > get_job > returns the job 0ms
 ✓ tests/unit/tools.test.ts > get_job > returns NOT_FOUND for unknown ids 0ms
 ✓ tests/unit/tools.test.ts > get_interview_slots > returns only future slots, in start order 17ms
 ✓ tests/unit/tools.test.ts > get_interview_slots > formats local start time in the requested timezone 1ms
 ✓ tests/unit/tools.test.ts > get_interview_slots > returns an empty list when every slot is in the past 0ms
 ✓ tests/unit/tools.test.ts > get_interview_slots > rejects unknown timezones 0ms
 ✓ tests/unit/tools.test.ts > get_interview_slots > returns INVALID_UPSTREAM_RESPONSE when the calendar payload is malformed 0ms
 ✓ tests/unit/tools.test.ts > send_message > sends via the provider and records the message in the outbox 1ms
 ✓ tests/unit/tools.test.ts > send_message > returns a retryable PROVIDER_UNAVAILABLE error when the provider is down 0ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: happy path > gathers data, drafts, passes checks and waits for approval 44ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: happy path > sends to the candidate address on file only after approval 6ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: happy path > works end to end with the template LLM used for fake mode 5ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: human control > sends the human-edited draft 4ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: human control > re-runs guardrails on human edits and keeps the run awaiting approval if they fail 4ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: human control > rejects a draft without sending 3ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: human control > does not send twice when approved twice 3ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: human control > can be approved after a server restart 23ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > stale data: drafts but surfaces a warning 9ms
 ✓ tests/data/csv-loader.test.ts > candidates.csv > loads every row of the clean export 2ms
 ✓ tests/data/csv-loader.test.ts > candidates.csv > maps source columns to the domain model 0ms
 ✓ tests/data/csv-loader.test.ts > candidates.csv > normalises whitespace and email casing 0ms
 ✓ tests/data/csv-loader.test.ts > candidates.csv > preserves non-ASCII names 0ms
 ✓ tests/data/csv-loader.test.ts > candidates.csv > keeps untrusted free-text notes verbatim (they are data, not instructions) 0ms
 ✓ tests/data/csv-loader.test.ts > malformed candidate export > keeps valid rows and rejects bad ones with line numbers and reasons 0ms
 ✓ tests/data/csv-loader.test.ts > jobs.csv > loads jobs and turns empty salary into null 15ms
 ✓ tests/data/csv-loader.test.ts > jobs.csv > rejects an unknown interview format 1ms
 ✓ tests/data/csv-loader.test.ts > slots.csv > parses timestamps as UTC instants and durations as integers 5ms
 ✓ tests/data/csv-loader.test.ts > slots.csv > rejects negative, non-numeric durations and bad dates 1ms
 ✓ tests/unit/eval-report.test.ts > summarise > passes a case at the default 2/3 threshold and marks it flaky 3ms
 ✓ tests/unit/eval-report.test.ts > summarise > requires 100% for safety regardless of the case pass rate 0ms
 ✓ tests/unit/eval-report.test.ts > summarise > aggregates per-criterion rates, tokens and latency 2ms
 ✓ tests/unit/eval-report.test.ts > compareToBaseline > reports no regressions when stable 0ms
 ✓ tests/unit/eval-report.test.ts > compareToBaseline > flags a criterion drop beyond tolerance and a newly failing case 0ms
 ✓ tests/unit/eval-report.test.ts > compareToBaseline for subset runs > ignores criterion-level drops when comparing a subset 0ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > invalid tool response: passes a structured error to the model, which stops cleanly 6ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > LLM timeout: retries once then fails visibly 48ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > LLM transient error: recovers on retry 9ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > non-transient LLM error: fails without retry 3ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > email provider down: send_failed, then retry succeeds once it recovers 8ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > unsafe request: blocked before any model call 3ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > malformed draft from the model: returned as a tool error and corrected 10ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > ungrounded draft: one revision allowed, then blocked 4ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > ungrounded draft: revised draft passes 5ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > drafting before gathering data is refused 4ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > access to other candidates is refused (least privilege) 2ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > step limit: fails when the model never finishes 2ms
 ✓ tests/integration/orchestrator.test.ts > orchestrator: injected failures > no open slots: template agent reports it cannot draft 2ms
 ✓ tests/unit/anthropic-client.test.ts > AnthropicClient > maps requests and responses between the SDK and the internal format 3ms
 ✓ tests/unit/anthropic-client.test.ts > classify > treats rate limit as transient 0ms
 ✓ tests/unit/anthropic-client.test.ts > classify > treats 5xx as transient 0ms
 ✓ tests/unit/anthropic-client.test.ts > classify > treats connection as transient 0ms
 ✓ tests/unit/anthropic-client.test.ts > classify > treats timeout as transient 0ms
 ✓ tests/unit/anthropic-client.test.ts > classify > does not retry client errors 0ms
 ✓ tests/data/presentation.test.ts > API presentation of source data > presents every source candidate with correctly transformed fields 87ms
 ✓ tests/data/presentation.test.ts > API presentation of source data > does not expose free-text recruiter notes in the candidate list 6ms
 ✓ tests/data/presentation.test.ts > API presentation of source data > flags exactly the candidates older than 90 days as stale 8ms
 ✓ tests/api/read.test.ts > GET /api/health > is public 87ms
 ✓ tests/api/read.test.ts > GET /api/candidates > 401 without a token 7ms
 ✓ tests/api/read.test.ts > GET /api/candidates > 401 with an unknown token 8ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 201: runs the agent to awaiting approval and returns the draft with its history 115ms
 ✓ tests/data/presentation.test.ts > API presentation of source data > shows jobs with salary range only when published 5ms
 ✓ tests/data/presentation.test.ts > API presentation of source data > reports rejected rows when the export is malformed 5ms
 ✓ tests/api/read.test.ts > GET /api/candidates > 200 for viewer 5ms
 ✓ tests/api/read.test.ts > GET /api/candidates > 200 for recruiter 4ms
 ✓ tests/api/read.test.ts > GET /api/jobs > 401 without a token 4ms
 ✓ tests/api/read.test.ts > GET /api/jobs > 401 with an unknown token 4ms
 ✓ tests/api/read.test.ts > GET /api/jobs > 200 for viewer 4ms
 ✓ tests/api/read.test.ts > GET /api/jobs > 200 for recruiter 4ms
 ✓ tests/api/read.test.ts > GET /api/runs > 401 without a token 3ms
 ✓ tests/api/read.test.ts > GET /api/runs > 401 with an unknown token 3ms
 ✓ tests/api/read.test.ts > GET /api/runs > 200 for viewer 3ms
 ✓ tests/api/read.test.ts > GET /api/runs > 200 for recruiter 3ms
 ✓ tests/api/read.test.ts > GET /api/data/validation > 401 without a token 7ms
 ✓ tests/api/read.test.ts > GET /api/data/validation > 401 with an unknown token 3ms
 ✓ tests/api/read.test.ts > GET /api/data/validation > 200 for viewer 3ms
 ✓ tests/api/read.test.ts > GET /api/data/validation > 200 for recruiter 3ms
 ✓ tests/api/read.test.ts > GET /api/runs/:id > 404 for an unknown run 4ms
 ✓ tests/api/read.test.ts > unknown routes > return the standard error shape 3ms
 ✓ tests/api/read.test.ts > web UI hosting > serves index.html for client routes but still 404s unknown API routes 13ms
 ✓ tests/api/runs.test.ts > POST /api/runs > is retrievable afterwards by id and in the list 8ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 400 for invalid body {} 6ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 400 for invalid body {"candidateId":"  ","jobId":"j-001"} 5ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 400 for invalid body {"candidateId":"c-001","jobId":"j-001","note":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} 5ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 400 for invalid body {"candidateId":42,"jobId":"j-001"} 4ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 400 for malformed JSON 5ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 404 for unknown candidate or job, without creating a run 5ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 401 without a token 4ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 403 for viewers 6ms
 ✓ tests/api/runs.test.ts > POST /api/runs > LLM timeout: 201 with a failed run and a user-visible reason 46ms
 ✓ tests/api/runs.test.ts > POST /api/runs > malformed calendar data: failed run explains slots are unavailable 5ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 200: sends the draft and records the approval 117ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 200: sends the recruiter edit 9ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 422: an unsafe edit is refused and the run stays awaiting approval 7ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 400 for invalid edit {"body":""} 7ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 400 for invalid edit {"subject":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} 7ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 400 for invalid edit {"to":"ceo@example.com"} 6ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 403 for viewers 6ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 401 without a token 8ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 404 for an unknown run 6ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > 409 when approving twice 7ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/approve > email provider down: send_failed with reason, then retry after recovery 6ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/reject > 200: rejects without sending 6ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/reject > 400 without a reason 6ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/reject > 403 for viewers 5ms
 ✓ tests/api/approval.test.ts > POST /api/runs/:id/reject > 409 once sent 5ms
 ✓ tests/api/runs.test.ts > POST /api/runs > stale candidate: draft carries a warning 6ms
 ✓ tests/api/runs.test.ts > POST /api/runs > unsafe note: blocked with the reason 4ms
 ✓ tests/api/runs.test.ts > POST /api/runs > 500 does not leak internals 4ms
 Test Files  12 passed (12)
      Tests  157 passed (157)
Statements   : 94.07% ( 572/608 )
Branches     : 86.56% ( 277/320 )
Functions    : 96.07% ( 147/153 )
Lines        : 95.01% ( 515/542 )
```

## Browser test (Playwright)

```
  ✓  1 [chromium] › e2e/invite.spec.ts:3:1 › recruiter drafts, edits, approves and sends an interview invite (994ms)
  1 passed (2.6s)
```
