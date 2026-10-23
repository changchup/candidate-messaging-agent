import type { DraftContext } from '../agent/guardrails.ts';
import type { Candidate, Job } from '../domain/schemas.ts';
import type { Run, RunEvent } from '../state/run-store.ts';
import { STALE_AFTER_DAYS } from '../tools/candidate-tools.ts';

const DAY_MS = 86_400_000;

export function presentCandidate(c: Candidate, jobs: Map<string, Job>, now: Date) {
  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`,
    email: c.email,
    currentTitle: c.currentTitle,
    location: c.location,
    timezone: c.timezone,
    skills: c.skills,
    appliedJob: { id: c.appliedJobId, title: jobs.get(c.appliedJobId)?.title ?? null },
    updatedAt: c.updatedAt.toISOString(),
    stale: (now.getTime() - c.updatedAt.getTime()) / DAY_MS > STALE_AFTER_DAYS,
  };
}

export function presentJob(j: Job) {
  return { ...j };
}

export function presentRun(run: Run, events?: RunEvent[]) {
  const context = run.context as DraftContext | null;
  const proposedSlots =
    run.draft && context
      ? run.draft.slotIds.flatMap((id) => context.slots.filter((s) => s.id === id))
      : [];
  return {
    id: run.id,
    state: run.state,
    candidateId: run.candidateId,
    jobId: run.jobId,
    note: run.note,
    createdBy: run.createdBy,
    draft: run.draft,
    recipient: context?.candidate.email ?? null,
    proposedSlots,
    warnings: run.warnings,
    violations: run.violations,
    error: run.error,
    messageId: run.messageId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(events ? { events } : {}),
  };
}
