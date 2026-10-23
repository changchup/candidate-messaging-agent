import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { buildTestApi, VIEWER } from '../helpers/api.ts';

/** Independent oracle: read the raw CSV directly and compare with what the API presents. */
const rawCandidates: Record<string, string>[] = parse(readFileSync('fixtures/data/candidates.csv', 'utf8'), {
  columns: true,
});
const rawJobs: Record<string, string>[] = parse(readFileSync('fixtures/data/jobs.csv', 'utf8'), { columns: true });

describe('API presentation of source data', () => {
  it('presents every source candidate with correctly transformed fields', async () => {
    const { app } = buildTestApi();
    const { candidates } = (await app.inject({ method: 'GET', url: '/api/candidates', headers: VIEWER })).json();

    expect(candidates).toHaveLength(rawCandidates.length);
    for (const raw of rawCandidates) {
      const shown = candidates.find((c: { id: string }) => c.id === raw.candidate_id);
      const job = rawJobs.find((j) => j.job_id === raw.applied_job_id);
      expect(shown).toEqual({
        id: raw.candidate_id,
        name: `${raw.first_name!.trim()} ${raw.last_name!.trim()}`,
        email: raw.email!.trim().toLowerCase(),
        currentTitle: raw.current_title,
        location: raw.location,
        timezone: raw.timezone,
        skills: raw.skills ? raw.skills.split('|') : [],
        appliedJob: { id: raw.applied_job_id, title: job?.title },
        updatedAt: new Date(raw.updated_at!).toISOString(),
        stale: expect.any(Boolean),
      });
    }
  });

  it('does not expose free-text recruiter notes in the candidate list', async () => {
    const { app } = buildTestApi();
    const res = await app.inject({ method: 'GET', url: '/api/candidates', headers: VIEWER });
    expect(res.body).not.toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
  });

  it('flags exactly the candidates older than 90 days as stale', async () => {
    const { app } = buildTestApi();
    const { candidates } = (await app.inject({ method: 'GET', url: '/api/candidates', headers: VIEWER })).json();
    expect(candidates.filter((c: { stale: boolean }) => c.stale).map((c: { id: string }) => c.id)).toEqual(['c-003']);
  });

  it('shows jobs with salary range only when published', async () => {
    const { app } = buildTestApi();
    const { jobs } = (await app.inject({ method: 'GET', url: '/api/jobs', headers: VIEWER })).json();
    expect(jobs.map((j: { id: string; salaryRange: string | null }) => [j.id, j.salaryRange])).toEqual(
      rawJobs.map((r) => [r.job_id, r.salary_range || null]),
    );
  });

  it('reports rejected rows when the export is malformed', async () => {
    const { app } = buildTestApi({ env: { DATA_DIR: 'fixtures/data/malformed-set' } });
    const { reports } = (await app.inject({ method: 'GET', url: '/api/data/validation', headers: VIEWER })).json();
    expect(reports).toEqual([
      { file: 'candidates.csv', loaded: 1, rejected: expect.arrayContaining([{ line: 4, errors: ['email: must be a valid email'] }]) },
      { file: 'jobs.csv', loaded: 4, rejected: [] },
      { file: 'slots.csv', loaded: 1, rejected: expect.any(Array) },
    ]);
  });
});
