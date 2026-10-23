import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  createApi,
  type CandidateDto,
  type JobDto,
  type RunDto,
  type RunEventDto,
} from './api.ts';

const TOKENS = { recruiter: 'recruiter-token', viewer: 'viewer-token' } as const;
type Role = keyof typeof TOKENS;

const STATE_LABEL: Record<string, string> = {
  awaiting_approval: 'Awaiting approval',
  send_failed: 'Send failed',
  sent: 'Sent',
  rejected: 'Rejected',
  blocked: 'Blocked',
  failed: 'Failed',
};

function readRole(): Role {
  try {
    return localStorage.getItem('role') === 'viewer' ? 'viewer' : 'recruiter';
  } catch {
    return 'recruiter';
  }
}

export function App() {
  const [role, setRole] = useState<Role>(readRole);
  const api = useMemo(() => createApi(TOKENS[role]), [role]);
  const [candidates, setCandidates] = useState<CandidateDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [current, setCurrent] = useState<RunDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshRuns = useCallback(() => api.runs().then((r) => setRuns(r.runs)), [api]);

  useEffect(() => {
    try {
      localStorage.setItem('role', role);
    } catch {
      /* storage unavailable; role just won't persist */
    }
    Promise.all([api.candidates(), api.jobs(), api.runs()])
      .then(([c, j, r]) => {
        setCandidates(c.candidates);
        setJobs(j.jobs);
        setRuns(r.runs);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [api, role]);

  const onRunChanged = (run: RunDto) => {
    setCurrent(run);
    void refreshRuns();
  };

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Candidate Messaging</h1>
        <label className="role">
          Signed in as
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="role">
            <option value="recruiter">Recruiter</option>
            <option value="viewer">Viewer (read-only)</option>
          </select>
        </label>
      </header>
      {loadError && <p className="banner error">Could not load data: {loadError}</p>}
      <main className="layout">
        <aside className="sidebar">
          <NewRunForm
            api={api}
            candidates={candidates}
            jobs={jobs}
            disabled={role !== 'recruiter'}
            onCreated={onRunChanged}
          />
          <RunList
            runs={runs}
            candidates={candidates}
            currentId={current?.id}
            onSelect={(id) => api.run(id).then((r) => setCurrent(r.run))}
          />
        </aside>
        <section className="detail">
          {current ? (
            <RunDetail
              key={current.id + current.state}
              run={current}
              api={api}
              canAct={role === 'recruiter'}
              onChanged={onRunChanged}
            />
          ) : (
            <p className="empty">
              Pick a candidate and draft an invitation, or open a previous run.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

function NewRunForm(props: {
  api: ReturnType<typeof createApi>;
  candidates: CandidateDto[];
  jobs: JobDto[];
  disabled: boolean;
  onCreated: (run: RunDto) => void;
}) {
  const [candidateId, setCandidateId] = useState('');
  const [jobId, setJobId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidate = props.candidates.find((c) => c.id === candidateId);

  const pickCandidate = (id: string) => {
    setCandidateId(id);
    const c = props.candidates.find((x) => x.id === id);
    if (c) setJobId(c.appliedJob.id);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { run } = await props.api.createRun({
        candidateId,
        jobId,
        ...(note.trim() ? { note } : {}),
      });
      props.onCreated(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>New interview invite</h2>
      <label>
        Candidate
        <select
          value={candidateId}
          onChange={(e) => pickCandidate(e.target.value)}
          data-testid="candidate"
          required
        >
          <option value="">Select a candidate…</option>
          {props.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.currentTitle}
              {c.stale ? ' (stale profile)' : ''}
            </option>
          ))}
        </select>
      </label>
      {candidate?.stale && (
        <p className="hint warn">
          Profile last updated {new Date(candidate.updatedAt).toLocaleDateString()}.
        </p>
      )}
      <label>
        Role
        <select value={jobId} onChange={(e) => setJobId(e.target.value)} data-testid="job" required>
          <option value="">Select a role…</option>
          {props.jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} · {j.team}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note for the assistant <span className="muted">(optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          data-testid="note"
        />
      </label>
      <button
        type="submit"
        className="primary"
        disabled={props.disabled || busy || !candidateId || !jobId}
        data-testid="draft"
      >
        {busy ? 'Drafting…' : 'Draft invite'}
      </button>
      {props.disabled && <p className="hint">Viewers can browse runs but cannot draft or send.</p>}
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function RunList(props: {
  runs: RunDto[];
  candidates: CandidateDto[];
  currentId?: string;
  onSelect: (id: string) => void;
}) {
  if (props.runs.length === 0) return null;
  const name = (id: string) => props.candidates.find((c) => c.id === id)?.name ?? id;
  return (
    <div className="card">
      <h2>Recent runs</h2>
      <ul className="runs">
        {props.runs.map((r) => (
          <li key={r.id}>
            <button
              className={r.id === props.currentId ? 'link active' : 'link'}
              onClick={() => props.onSelect(r.id)}
            >
              <span>{name(r.candidateId)}</span>
              <StateBadge state={r.state} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`badge s-${state}`} data-testid="run-state">
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

function RunDetail(props: {
  run: RunDto;
  api: ReturnType<typeof createApi>;
  canAct: boolean;
  onChanged: (run: RunDto) => void;
}) {
  const { run } = props;
  const [subject, setSubject] = useState(run.draft?.subject ?? '');
  const [body, setBody] = useState(run.draft?.body ?? '');
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<{ message: string; details?: string[] } | null>(
    null,
  );
  const actionable = run.state === 'awaiting_approval' || run.state === 'send_failed';

  const act = async (fn: () => Promise<{ run: RunDto }>) => {
    setBusy(true);
    setActionError(null);
    try {
      props.onChanged((await fn()).run);
    } catch (e) {
      setActionError({
        message: e instanceof Error ? e.message : String(e),
        details:
          e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]) : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    const edits: { subject?: string; body?: string } = {};
    if (subject !== run.draft?.subject) edits.subject = subject;
    if (body !== run.draft?.body) edits.body = body;
    return act(() => props.api.approve(run.id, edits));
  };

  return (
    <div className="card run" data-testid="run-detail">
      <div className="run-head">
        <h2>Invitation draft</h2>
        <StateBadge state={run.state} />
      </div>

      {run.state === 'sent' && (
        <p className="banner ok" data-testid="sent-banner">
          Sent to {run.recipient} (message {run.messageId}).
        </p>
      )}
      {run.error && (
        <p className="banner error" data-testid="run-error">
          <strong>{run.error.code}:</strong> {run.error.message}
        </p>
      )}
      {run.violations.length > 0 && (
        <div className="banner error" data-testid="violations">
          <strong>Blocked by safety checks</strong>
          <ul>
            {run.violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {run.warnings.length > 0 && (
        <div className="banner warn" data-testid="warnings">
          <ul>
            {run.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {run.draft && (
        <>
          <p className="muted">To: {run.recipient}</p>
          <label>
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!actionable || !props.canAct}
              data-testid="subject"
            />
          </label>
          <label>
            Message
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              disabled={!actionable || !props.canAct}
              data-testid="body"
            />
          </label>
          {run.proposedSlots.length > 0 && (
            <div>
              <h3>Proposed slots</h3>
              <ul className="slots">
                {run.proposedSlots.map((s) => (
                  <li key={s.id}>
                    {s.localStart} · {s.durationMinutes} min with {s.interviewer}{' '}
                    <span className="muted">({s.id})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {actionable && props.canAct && (
        <div className="actions">
          <button className="primary" onClick={approve} disabled={busy} data-testid="approve">
            {run.state === 'send_failed' ? 'Retry send' : 'Approve & send'}
          </button>
          <input
            placeholder="Reason for rejecting"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            data-testid="reject-reason"
          />
          <button
            onClick={() => act(() => props.api.reject(run.id, rejectReason))}
            disabled={busy || !rejectReason.trim()}
            data-testid="reject"
          >
            Reject
          </button>
        </div>
      )}
      {actionError && (
        <div className="banner error" role="alert" data-testid="action-error">
          {actionError.message}
          {actionError.details && (
            <ul>
              {actionError.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {run.events && <Timeline events={run.events} />}
    </div>
  );
}

function describeEvent(e: RunEventDto): string {
  const d = e.data;
  switch (e.type) {
    case 'state_change':
      return `${d.from ?? '—'} → ${d.to}${d.reason ? ` (${d.reason})` : ''}`;
    case 'llm_call':
      return d.error
        ? `model call failed (attempt ${d.attempt}): ${d.error}`
        : `model turn ${d.turn}: ${(d.toolCalls as string[]).join(', ') || 'text'} · ${d.durationMs}ms`;
    case 'tool_call':
      return `${d.tool} ${d.ok ? 'ok' : `failed: ${JSON.stringify(d.error)}`}${d.durationMs !== undefined ? ` · ${d.durationMs}ms` : ''}`;
    case 'guardrail':
      return `checks (${d.stage}): ${(d.violations as string[]).length} violations, ${(d.warnings as string[]).length} warnings`;
    case 'human_action':
      return `${d.actor} ${d.action}${d.edited ? ' (edited)' : ''}${d.reason ? `: ${d.reason}` : ''}`;
    default:
      return JSON.stringify(d);
  }
}

function Timeline({ events }: { events: RunEventDto[] }) {
  return (
    <details className="timeline" data-testid="timeline">
      <summary>Execution history ({events.length} events)</summary>
      <ol>
        {events.map((e) => (
          <li key={e.seq} className={`ev ev-${e.type}${(e.data.violations as string[] | undefined)?.length ? ' ev-blocking' : ''}`}>
            <span className="muted">{new Date(e.at).toLocaleTimeString()}</span>{' '}
            <code>{e.type}</code> {describeEvent(e)}
          </li>
        ))}
      </ol>
    </details>
  );
}
