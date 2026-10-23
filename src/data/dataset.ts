import { join } from 'node:path';
import { loadCsvFile, type RejectedRow } from './csv-loader.ts';
import {
  CandidateRowSchema,
  JobRowSchema,
  SlotRowSchema,
  type Candidate,
  type Job,
  type Slot,
} from '../domain/schemas.ts';

export interface ValidationReport {
  file: string;
  loaded: number;
  rejected: RejectedRow[];
}

/** Read-only access to the ATS snapshot. Swappable for a real ATS client. */
export interface Repository {
  listCandidates(): Candidate[];
  getCandidate(id: string): Candidate | undefined;
  listJobs(): Job[];
  getJob(id: string): Job | undefined;
  listSlots(jobId: string): Slot[];
}

export function createRepository(data: {
  candidates: Candidate[];
  jobs: Job[];
  slots: Slot[];
}): Repository {
  const candidates = new Map(data.candidates.map((c) => [c.id, c]));
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  return {
    listCandidates: () => [...candidates.values()],
    getCandidate: (id) => candidates.get(id),
    listJobs: () => [...jobs.values()],
    getJob: (id) => jobs.get(id),
    listSlots: (jobId) =>
      data.slots
        .filter((s) => s.jobId === jobId)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
  };
}

export function loadDataset(dir: string): { repository: Repository; reports: ValidationReport[] } {
  const candidates = loadCsvFile(join(dir, 'candidates.csv'), CandidateRowSchema);
  const jobs = loadCsvFile(join(dir, 'jobs.csv'), JobRowSchema);
  const slots = loadCsvFile(join(dir, 'slots.csv'), SlotRowSchema);
  return {
    repository: createRepository({
      candidates: candidates.records,
      jobs: jobs.records,
      slots: slots.records,
    }),
    reports: [
      { file: 'candidates.csv', loaded: candidates.records.length, rejected: candidates.rejected },
      { file: 'jobs.csv', loaded: jobs.records.length, rejected: jobs.rejected },
      { file: 'slots.csv', loaded: slots.records.length, rejected: slots.rejected },
    ],
  };
}
