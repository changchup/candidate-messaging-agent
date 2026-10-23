import type { Draft, Job } from '../domain/schemas.ts';
import type { CandidateView } from '../tools/candidate-tools.ts';
import type { SlotView } from '../tools/slot-tools.ts';

/** The tool data a draft must be grounded in. */
export interface DraftContext {
  candidate: CandidateView;
  job: Job;
  slots: SlotView[];
}

export interface GuardrailResult {
  /** Blocking problems: the draft must not be offered for sending. */
  violations: string[];
  /** Non-blocking issues surfaced to the recruiter. */
  warnings: string[];
}

/**
 * Topics a recruiter must not raise with a candidate (protected characteristics in most
 * employment law). Deliberately conservative keyword patterns; false positives go to a human.
 */
const PROTECTED_PATTERNS: [string, RegExp][] = [
  ['age', /\b(how old|your age|date of birth|year of birth|born in \d{4}|too old|too young)\b/i],
  [
    'family status',
    /\b(pregnan\w*|maternity|paternity|family (plans?|circumstances|situation|status|commitments)|plan(s|ning)? (to have|on having) (kids|children)|have (kids|children)|(young )?(kids|children)|childcare|married|marital|spouse|husband|wife)\b/i,
  ],
  ['religion', /\b(religio\w*|church|mosque|synagogue|temple|faith|pray\w*)\b/i],
  [
    'national origin / ethnicity',
    /\b(nationality|citizenship|ethnic\w*|race|accent|native speaker|where are you (really )?from)\b/i,
  ],
  [
    'health / disability',
    /\b(disabilit\w*|disabled|health (condition|issues?)|medical (condition|history)|sick (leave|days)|mental health)\b/i,
  ],
  [
    'sexual orientation / gender identity',
    /\b(sexual orientation|gay|lesbian|transgender|gender identity)\b/i,
  ],
];

const MONEY =
  /(?:[$£€]|\b(?:NZD|USD|AUD|GBP|EUR)\b)\s?\d(?:[\d,.]*\d)?\s?k?|\b\d(?:[\d,.]*\d)?\s?k\b|\bsalary\b|\bcompensation\b|\bpay (range|band)\b/gi;
const PLACEHOLDER = /\{\{.*?\}\}|\[(candidate|name|first name|job|role|company|date|time)[^\]]*\]/i;

export function protectedTopics(text: string): string[] {
  return PROTECTED_PATTERNS.filter(([, re]) => re.test(text)).map(([topic]) => topic);
}

/** Pre-flight check on the recruiter's free-text instruction, before any model call. */
export function checkRequest(note: string): GuardrailResult {
  const topics = protectedTopics(note);
  return {
    violations: topics.map(
      (t) =>
        `Request asks to raise a protected topic (${t}); this cannot be included in candidate messaging.`,
    ),
    warnings: [],
  };
}

const digits = (s: string) => s.replace(/[^\d]/g, '');

export function checkDraft(
  draft: Draft,
  ctx: DraftContext,
  opts: { otherCandidateNames?: string[] } = {},
): GuardrailResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const text = `${draft.subject}\n${draft.body}`;

  const validSlots = new Set(ctx.slots.filter((s) => s.jobId === ctx.job.id).map((s) => s.id));
  for (const id of draft.slotIds) {
    if (!validSlots.has(id))
      violations.push(`Proposed slot ${id} is not an available future slot for ${ctx.job.id}.`);
  }

  if (!new RegExp(`\\b${escapeRegExp(ctx.candidate.firstName)}\\b`, 'i').test(draft.body)) {
    violations.push(`Message does not address the candidate by name (${ctx.candidate.firstName}).`);
  }
  for (const name of opts.otherCandidateNames ?? []) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text)) {
      violations.push(`Message mentions another candidate (${name}).`);
    }
  }

  for (const topic of protectedTopics(text)) {
    violations.push(`Message raises a protected topic (${topic}).`);
  }

  const money = text.match(MONEY) ?? [];
  if (money.length > 0) {
    if (!ctx.job.salaryRange) {
      violations.push('Message mentions compensation but the job has no published salary range.');
    } else {
      const allowed = digits(ctx.job.salaryRange);
      const unsupported = money.filter((m) => digits(m) && !allowed.includes(digits(m)));
      if (unsupported.length) {
        violations.push(
          `Message states compensation not in the job's salary range (${unsupported.join(', ')}).`,
        );
      }
    }
  }

  if (PLACEHOLDER.test(text)) violations.push('Message contains an unfilled template placeholder.');

  if (ctx.candidate.stale) {
    warnings.push(
      `Candidate profile was last updated ${ctx.candidate.daysSinceUpdate} days ago; confirm details are current before sending.`,
    );
  }
  if (!text.toLowerCase().includes(ctx.job.title.toLowerCase())) {
    warnings.push(`Message does not mention the role title (${ctx.job.title}).`);
  }

  return { violations, warnings };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
