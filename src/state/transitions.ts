export const RUN_STATES = [
  'created',
  'gathering',
  'drafting',
  'checking',
  'awaiting_approval',
  'sending',
  'sent',
  'send_failed',
  'rejected',
  'blocked',
  'failed',
] as const;
export type RunState = (typeof RUN_STATES)[number];

const ALLOWED: Record<RunState, RunState[]> = {
  created: ['gathering', 'blocked', 'failed'],
  gathering: ['drafting', 'failed'],
  // drafting → gathering: submitted draft was malformed, hand back to the model
  drafting: ['checking', 'gathering', 'failed'],
  // checking → gathering: guardrail violations fed back to the model for one revision
  checking: ['awaiting_approval', 'gathering', 'blocked', 'failed'],
  awaiting_approval: ['sending', 'rejected'],
  sending: ['sent', 'send_failed'],
  send_failed: ['sending', 'rejected'],
  sent: [],
  rejected: [],
  blocked: [],
  failed: [],
};

export const TERMINAL_STATES: ReadonlySet<RunState> = new Set(
  RUN_STATES.filter((s) => ALLOWED[s].length === 0),
);

export function canTransition(from: RunState, to: RunState): boolean {
  return ALLOWED[from].includes(to);
}

export class InvalidTransitionError extends Error {
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState) {
    super(`Cannot move run from ${from} to ${to}`);
    this.from = from;
    this.to = to;
  }
}
