import { z } from 'zod';

const trimmed = z.string().trim();
const required = trimmed.min(1, 'is required');
const collapseSpaces = (s: string) => s.replace(/\s+/g, ' ');
const isoDate = required.pipe(
  z.iso.datetime({ offset: true, error: 'must be an ISO-8601 timestamp' }),
);

/** One row of the ATS candidate export, as raw CSV strings, transformed into a domain Candidate. */
export const CandidateRowSchema = z
  .object({
    candidate_id: required,
    first_name: required,
    last_name: required,
    email: required.toLowerCase().pipe(z.email({ error: 'must be a valid email' })),
    current_title: trimmed.default(''),
    location: trimmed.default(''),
    timezone: required,
    skills: trimmed.default(''),
    notes: trimmed.default(''),
    applied_job_id: required,
    updated_at: isoDate,
  })
  .transform((r) => ({
    id: r.candidate_id,
    firstName: collapseSpaces(r.first_name),
    lastName: collapseSpaces(r.last_name),
    email: r.email,
    currentTitle: r.current_title,
    location: r.location,
    timezone: r.timezone,
    skills: r.skills
      ? r.skills
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    notes: r.notes,
    appliedJobId: r.applied_job_id,
    updatedAt: new Date(r.updated_at),
  }));
export type Candidate = z.output<typeof CandidateRowSchema>;

export const JobRowSchema = z
  .object({
    job_id: required,
    title: required,
    team: required,
    location: required,
    hiring_manager: required,
    interview_format: z.enum(['video', 'onsite', 'phone'], {
      error: 'must be video, onsite or phone',
    }),
    salary_range: trimmed.default(''),
    description: trimmed.default(''),
  })
  .transform((r) => ({
    id: r.job_id,
    title: collapseSpaces(r.title),
    team: r.team,
    location: r.location,
    hiringManager: r.hiring_manager,
    interviewFormat: r.interview_format,
    salaryRange: r.salary_range || null,
    description: r.description,
  }));
export type Job = z.output<typeof JobRowSchema>;

export const SlotRowSchema = z
  .object({
    slot_id: required,
    job_id: required,
    starts_at: isoDate,
    duration_minutes: z.coerce
      .number({ error: 'must be a number' })
      .int('must be a whole number')
      .positive('must be positive'),
    interviewer: required,
  })
  .transform((r) => ({
    id: r.slot_id,
    jobId: r.job_id,
    startsAt: new Date(r.starts_at),
    durationMinutes: r.duration_minutes,
    interviewer: r.interviewer,
  }));
export type Slot = z.output<typeof SlotRowSchema>;

/** Shape the agent must submit via the submit_draft tool. */
export const DraftSchema = z.object({
  subject: trimmed.min(1).max(200),
  body: trimmed.min(1).max(5000),
  slotIds: z.array(z.string().min(1)).min(1).max(5),
  citedFacts: z.array(z.string().min(1)).max(20).default([]),
  /** Private explanation for the recruiter (e.g. parts of their note that were declined). Never sent. */
  recruiterNotes: z.string().trim().max(1000).optional(),
});
export type Draft = z.infer<typeof DraftSchema>;
