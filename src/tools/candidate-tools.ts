import { z } from 'zod';
import type { Repository } from '../data/dataset.ts';
import { err, ok, type ToolResult } from './result.ts';

export const STALE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const GetCandidateInput = z.object({ candidateId: z.string().min(1) });
export const GetJobInput = z.object({ jobId: z.string().min(1) });

export interface CandidateView {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  currentTitle: string;
  location: string;
  timezone: string;
  skills: string[];
  notes: string;
  appliedJobId: string;
  updatedAt: string;
  daysSinceUpdate: number;
  stale: boolean;
}

export function createGetCandidate(deps: { repository: Repository; now: () => Date }) {
  return async (input: z.infer<typeof GetCandidateInput>): Promise<ToolResult<CandidateView>> => {
    const c = deps.repository.getCandidate(input.candidateId);
    if (!c) return err('NOT_FOUND', `No candidate with id ${input.candidateId}`);
    const daysSinceUpdate = Math.floor((deps.now().getTime() - c.updatedAt.getTime()) / DAY_MS);
    return ok({
      ...c,
      updatedAt: c.updatedAt.toISOString(),
      daysSinceUpdate,
      stale: daysSinceUpdate > STALE_AFTER_DAYS,
    });
  };
}

export function createGetJob(deps: { repository: Repository }) {
  return async (input: z.infer<typeof GetJobInput>) => {
    const job = deps.repository.getJob(input.jobId);
    return job ? ok(job) : err('NOT_FOUND', `No job with id ${input.jobId}`);
  };
}
