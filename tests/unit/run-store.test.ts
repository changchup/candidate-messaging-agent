import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRunStore } from '../../src/state/run-store.ts';
import { InvalidTransitionError } from '../../src/state/transitions.ts';
import { fixedClock } from '../helpers/fixtures.ts';

const newRun = {
  id: 'r-1',
  candidateId: 'c-001',
  jobId: 'j-001',
  note: '',
  createdBy: 'recruiter',
};
const draft = { subject: 'Interview', body: 'Hi Priya', slotIds: ['s-101'], citedFacts: [] };

describe('RunStore', () => {
  it('creates runs in the created state with an initial event', () => {
    const store = openRunStore(':memory:', fixedClock);
    const run = store.create(newRun);
    expect(run).toMatchObject({
      state: 'created',
      draft: null,
      warnings: [],
      createdAt: '2026-10-23T12:00:00.000Z',
    });
    expect(store.events('r-1')).toEqual([
      {
        seq: 1,
        at: '2026-10-23T12:00:00.000Z',
        type: 'state_change',
        data: { from: null, to: 'created' },
      },
    ]);
  });

  it('applies allowed transitions with patches and records them', () => {
    const store = openRunStore(':memory:', fixedClock);
    store.create(newRun);
    store.transition('r-1', 'gathering');
    store.transition('r-1', 'drafting', { draft });
    const run = store.transition('r-1', 'checking', { warnings: ['stale'] }, 'draft submitted');
    expect(run).toMatchObject({ state: 'checking', draft, warnings: ['stale'] });
    expect(store.events('r-1').map((e) => e.data)).toEqual([
      { from: null, to: 'created' },
      { from: 'created', to: 'gathering' },
      { from: 'gathering', to: 'drafting' },
      { from: 'drafting', to: 'checking', reason: 'draft submitted' },
    ]);
  });

  it('rejects illegal transitions and leaves state untouched', () => {
    const store = openRunStore(':memory:', fixedClock);
    store.create(newRun);
    expect(() => store.transition('r-1', 'sending')).toThrow(InvalidTransitionError);
    expect(store.get('r-1')?.state).toBe('created');
    expect(store.events('r-1')).toHaveLength(1);
  });

  it('does not allow leaving a terminal state', () => {
    const store = openRunStore(':memory:', fixedClock);
    store.create(newRun);
    store.transition('r-1', 'failed', { error: { code: 'X', message: 'boom' } });
    expect(() => store.transition('r-1', 'gathering')).toThrow(InvalidTransitionError);
  });

  it('persists runs and events across reopen (server restart)', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'runs-')), 'app.db');
    const first = openRunStore(path, fixedClock);
    first.create(newRun);
    first.transition('r-1', 'gathering');
    first.transition('r-1', 'drafting', { draft, context: { candidate: { firstName: 'Priya' } } });
    first.transition('r-1', 'checking');
    first.transition('r-1', 'awaiting_approval');
    first.close();

    const second = openRunStore(path, fixedClock);
    expect(second.get('r-1')).toMatchObject({
      state: 'awaiting_approval',
      draft,
      context: { candidate: { firstName: 'Priya' } },
    });
    expect(second.events('r-1')).toHaveLength(5);
  });
});
