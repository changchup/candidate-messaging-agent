import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { requireRole } from '../auth.ts';
import { HttpError, parseBody } from '../errors.ts';
import { presentRun } from '../presenters.ts';

const CreateRunBody = z.object({
  candidateId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional(),
});

const ApproveBody = z
  .object({
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(5000).optional(),
  })
  .strict();

const RejectBody = z.object({ reason: z.string().trim().min(1).max(500) });

type IdParams = { Params: { id: string } };

export function runRoutes(app: FastifyInstance, ctx: AppContext) {
  const recruiterOnly = { preHandler: requireRole('recruiter') };

  app.post('/api/runs', recruiterOnly, async (request, reply) => {
    const body = parseBody(CreateRunBody, request.body);
    if (!ctx.repository.getCandidate(body.candidateId)) {
      throw new HttpError(404, 'NOT_FOUND', `Unknown candidate ${body.candidateId}`);
    }
    if (!ctx.repository.getJob(body.jobId))
      throw new HttpError(404, 'NOT_FOUND', `Unknown job ${body.jobId}`);

    const run = await ctx.orchestrator.startRun({ ...body, createdBy: request.user.actor });
    return reply.status(201).send({ run: presentRun(run, ctx.store.events(run.id)) });
  });

  app.get('/api/runs', async () => ({ runs: ctx.store.list().map((r) => presentRun(r)) }));

  app.get<IdParams>('/api/runs/:id', async (request) => {
    const run = ctx.store.get(request.params.id);
    if (!run) throw new HttpError(404, 'NOT_FOUND', `Run ${request.params.id} not found`);
    return { run: presentRun(run, ctx.store.events(run.id)) };
  });

  app.post<IdParams>('/api/runs/:id/approve', recruiterOnly, async (request) => {
    const body = parseBody(ApproveBody, request.body);
    const run = await ctx.orchestrator.approve(request.params.id, {
      ...body,
      actor: request.user.actor,
    });
    return { run: presentRun(run, ctx.store.events(run.id)) };
  });

  app.post<IdParams>('/api/runs/:id/reject', recruiterOnly, async (request) => {
    const body = parseBody(RejectBody, request.body);
    const run = ctx.orchestrator.reject(request.params.id, { ...body, actor: request.user.actor });
    return { run: presentRun(run, ctx.store.events(run.id)) };
  });
}
