import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.ts';
import { presentCandidate, presentJob } from '../presenters.ts';

export function dataRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/candidates', async () => {
    const jobs = new Map(ctx.repository.listJobs().map((j) => [j.id, j]));
    return {
      candidates: ctx.repository.listCandidates().map((c) => presentCandidate(c, jobs, ctx.now())),
    };
  });

  app.get('/api/jobs', async () => ({ jobs: ctx.repository.listJobs().map(presentJob) }));

  /** Source-data validation report: which ATS rows were rejected and why. */
  app.get('/api/data/validation', async () => ({ reports: ctx.reports }));
}
