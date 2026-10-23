import { describe, expect, it } from 'vitest';
import { checkDraft, checkRequest, type DraftContext } from '../../src/agent/guardrails.ts';
import type { Job } from '../../src/domain/schemas.ts';
import type { CandidateView } from '../../src/tools/candidate-tools.ts';

const candidate: CandidateView = {
  id: 'c-001',
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya.sharma@example.com',
  currentTitle: 'Backend Engineer',
  location: 'Auckland, NZ',
  timezone: 'Pacific/Auckland',
  skills: ['TypeScript'],
  notes: '',
  appliedJobId: 'j-001',
  updatedAt: '2026-10-12T09:30:00.000Z',
  daysSinceUpdate: 11,
  stale: false,
};
const job: Job = {
  id: 'j-001',
  title: 'Senior Backend Engineer',
  team: 'Payments',
  location: 'Remote',
  hiringManager: 'Sam Lee',
  interviewFormat: 'video',
  salaryRange: 'NZD 170,000–200,000',
  description: '',
};
const slot = {
  id: 's-101',
  jobId: 'j-001',
  startsAt: '2026-10-28T21:00:00.000Z',
  durationMinutes: 45,
  interviewer: 'Sam Lee',
  localStart: 'Thursday 29 October, 10:00 NZDT',
};
const ctx: DraftContext = { candidate, job, slots: [slot] };

const good = {
  subject: 'Interview invitation: Senior Backend Engineer',
  body: 'Hi Priya,\n\nWe would love to invite you to a video interview for the Senior Backend Engineer role on Thursday 29 October, 10:00 NZDT with Sam Lee.\n\nBest,\nTalent Team',
  slotIds: ['s-101'],
  citedFacts: [],
};

const withBody = (body: string) => ({ ...good, body });

describe('checkDraft', () => {
  it('passes a grounded, safe draft', () => {
    expect(checkDraft(good, ctx)).toEqual({ violations: [], warnings: [] });
  });

  it('blocks slots that are not available for the job', () => {
    const r = checkDraft({ ...good, slotIds: ['s-101', 's-999'] }, ctx);
    expect(r.violations).toEqual([
      'Proposed slot s-999 is not an available future slot for j-001.',
    ]);
  });

  it('blocks a draft that does not address the candidate by name', () => {
    expect(
      checkDraft(withBody('Hi there, Senior Backend Engineer interview?'), ctx).violations,
    ).toEqual(['Message does not address the candidate by name (Priya).']);
  });

  it('blocks a draft that leaks another candidate name', () => {
    const r = checkDraft(withBody(`${good.body} Elena Rossi also applied.`), ctx, {
      otherCandidateNames: ['Elena Rossi'],
    });
    expect(r.violations).toEqual(['Message mentions another candidate (Elena Rossi).']);
  });

  it.each([
    ['Do you have family plans in the next year?', 'family status'],
    ['Please confirm your date of birth.', 'age'],
    ['Let us know about your religion so we can schedule.', 'religion'],
    ['What is your nationality?', 'national origin / ethnicity'],
    ['Do you have any medical condition we should know about?', 'health / disability'],
  ])('blocks protected topic: %s', (sentence, topic) => {
    expect(checkDraft(withBody(`${good.body} ${sentence}`), ctx).violations).toEqual([
      `Message raises a protected topic (${topic}).`,
    ]);
  });

  it('does not flag ordinary words that contain protected substrings', () => {
    expect(
      checkDraft(withBody(`${good.body} Our message: we manage a great stage of growth.`), ctx)
        .violations,
    ).toEqual([]);
  });

  it('allows compensation that matches the published range', () => {
    expect(
      checkDraft(withBody(`${good.body} The range is NZD 170,000–200,000.`), ctx).violations,
    ).toEqual([]);
  });

  it('blocks compensation that is not in the published range', () => {
    const r = checkDraft(withBody(`${good.body} We can offer $500,000.`), ctx);
    expect(r.violations).toEqual([
      "Message states compensation not in the job's salary range ($500,000).",
    ]);
  });

  it('blocks any compensation when the job has no published range', () => {
    const r = checkDraft(withBody(`${good.body} Salary is negotiable.`), {
      ...ctx,
      job: { ...job, salaryRange: null },
    });
    expect(r.violations).toEqual([
      'Message mentions compensation but the job has no published salary range.',
    ]);
  });

  it('blocks unfilled template placeholders', () => {
    expect(checkDraft(withBody(`${good.body} See you on {{date}}.`), ctx).violations).toEqual([
      'Message contains an unfilled template placeholder.',
    ]);
  });

  it('warns (but does not block) when the candidate data is stale', () => {
    const r = checkDraft(good, {
      ...ctx,
      candidate: { ...candidate, stale: true, daysSinceUpdate: 592 },
    });
    expect(r.violations).toEqual([]);
    expect(r.warnings).toEqual([
      'Candidate profile was last updated 592 days ago; confirm details are current before sending.',
    ]);
  });

  it('warns when the role title is missing', () => {
    expect(
      checkDraft({ ...good, subject: 'Interview', body: 'Hi Priya, can we chat?' }, ctx).warnings,
    ).toEqual(['Message does not mention the role title (Senior Backend Engineer).']);
  });
});

describe('checkRequest', () => {
  it('accepts a normal recruiter note', () => {
    expect(checkRequest('Mention that the team is fully remote.')).toEqual({
      violations: [],
      warnings: [],
    });
  });

  it('blocks a note asking to probe protected topics', () => {
    expect(checkRequest('Ask whether she is planning to have kids soon').violations).toEqual([
      'Request asks to raise a protected topic (family status); this cannot be included in candidate messaging.',
    ]);
  });
});
