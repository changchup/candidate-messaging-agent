import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Draft } from '../domain/schemas.ts';
import { canTransition, InvalidTransitionError, type RunState } from './transitions.ts';

export type EventType =
  'state_change' | 'llm_call' | 'tool_call' | 'guardrail' | 'human_action' | 'error';

export interface RunEvent {
  seq: number;
  at: string;
  type: EventType;
  data: Record<string, unknown>;
}

export interface RunError {
  code: string;
  message: string;
}

export interface Run {
  id: string;
  candidateId: string;
  jobId: string;
  note: string;
  createdBy: string;
  state: RunState;
  draft: Draft | null;
  /** Tool data the draft was grounded on; re-used for guardrail checks on human edits. */
  context: Record<string, unknown> | null;
  warnings: string[];
  violations: string[];
  error: RunError | null;
  messageId: string | null;
  createdAt: string;
  updatedAt: string;
}

type RunPatch = Partial<
  Pick<Run, 'draft' | 'context' | 'warnings' | 'violations' | 'error' | 'messageId'>
>;

export interface RunStore {
  create(input: Pick<Run, 'id' | 'candidateId' | 'jobId' | 'note' | 'createdBy'>): Run;
  get(id: string): Run | undefined;
  list(limit?: number): Run[];
  /** Validates the transition, applies the patch and records a state_change event atomically. */
  transition(id: string, to: RunState, patch?: RunPatch, reason?: string): Run;
  update(id: string, patch: RunPatch): Run;
  appendEvent(runId: string, type: EventType, data: Record<string, unknown>): RunEvent;
  events(runId: string): RunEvent[];
  close(): void;
}

interface RunRow {
  id: string;
  candidate_id: string;
  job_id: string;
  note: string;
  created_by: string;
  state: RunState;
  draft: string | null;
  context: string | null;
  warnings: string;
  violations: string;
  error: string | null;
  message_id: string | null;
  created_at: string;
  updated_at: string;
}

const json = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T));

function toRun(r: RunRow): Run {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    jobId: r.job_id,
    note: r.note,
    createdBy: r.created_by,
    state: r.state,
    draft: json<Draft>(r.draft),
    context: json<Record<string, unknown>>(r.context),
    warnings: json<string[]>(r.warnings) ?? [],
    violations: json<string[]>(r.violations) ?? [],
    error: json<RunError>(r.error),
    messageId: r.message_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function openRunStore(path: string, now: () => Date = () => new Date()): RunStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      note TEXT NOT NULL,
      created_by TEXT NOT NULL,
      state TEXT NOT NULL,
      draft TEXT,
      context TEXT,
      warnings TEXT NOT NULL DEFAULT '[]',
      violations TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL REFERENCES runs(id),
      seq INTEGER NOT NULL,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );
  `);

  const get = (id: string) => {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row && toRun(row);
  };

  const mustGet = (id: string) => {
    const run = get(id);
    if (!run) throw new Error(`Run ${id} not found`);
    return run;
  };

  const writePatch = (id: string, patch: RunPatch, state?: RunState) => {
    const sets: string[] = ['updated_at = ?'];
    const values: (string | null)[] = [now().toISOString()];
    const columns: Record<keyof RunPatch, string> = {
      draft: 'draft',
      context: 'context',
      warnings: 'warnings',
      violations: 'violations',
      error: 'error',
      messageId: 'message_id',
    };
    for (const [key, column] of Object.entries(columns) as [keyof RunPatch, string][]) {
      if (key in patch) {
        const v = patch[key];
        sets.push(`${column} = ?`);
        values.push(
          key === 'messageId' ? (v as string | null) : v == null ? null : JSON.stringify(v),
        );
      }
    }
    if (state) {
      sets.push('state = ?');
      values.push(state);
    }
    db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  };

  const appendEvent: RunStore['appendEvent'] = (runId, type, data) => {
    const { next } = db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE run_id = ?')
      .get(runId) as { next: number };
    const event: RunEvent = { seq: next, at: now().toISOString(), type, data };
    db.prepare('INSERT INTO run_events (run_id, seq, at, type, data) VALUES (?, ?, ?, ?, ?)').run(
      runId,
      event.seq,
      event.at,
      type,
      JSON.stringify(data),
    );
    return event;
  };

  return {
    create(input) {
      const at = now().toISOString();
      db.prepare(
        `INSERT INTO runs (id, candidate_id, job_id, note, created_by, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'created', ?, ?)`,
      ).run(input.id, input.candidateId, input.jobId, input.note, input.createdBy, at, at);
      appendEvent(input.id, 'state_change', { from: null, to: 'created' });
      return mustGet(input.id);
    },
    get,
    list(limit = 50) {
      const rows = db
        .prepare('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(limit) as unknown as RunRow[];
      return rows.map(toRun);
    },
    transition(id, to, patch = {}, reason) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const run = mustGet(id);
        if (!canTransition(run.state, to)) throw new InvalidTransitionError(run.state, to);
        writePatch(id, patch, to);
        appendEvent(id, 'state_change', { from: run.state, to, ...(reason ? { reason } : {}) });
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return mustGet(id);
    },
    update(id, patch) {
      mustGet(id);
      writePatch(id, patch);
      return mustGet(id);
    },
    appendEvent,
    events(runId) {
      const rows = db
        .prepare('SELECT seq, at, type, data FROM run_events WHERE run_id = ? ORDER BY seq')
        .all(runId) as { seq: number; at: string; type: EventType; data: string }[];
      return rows.map((r) => ({ ...r, data: JSON.parse(r.data) as Record<string, unknown> }));
    },
    close: () => db.close(),
  };
}
