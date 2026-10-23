export interface CandidateDto {
  id: string;
  name: string;
  email: string;
  currentTitle: string;
  timezone: string;
  appliedJob: { id: string; title: string | null };
  updatedAt: string;
  stale: boolean;
}

export interface JobDto {
  id: string;
  title: string;
  team: string;
}

export interface RunEventDto {
  seq: number;
  at: string;
  type: string;
  data: Record<string, unknown>;
}

export interface RunDto {
  id: string;
  state: string;
  candidateId: string;
  jobId: string;
  note: string;
  draft: {
    subject: string;
    body: string;
    slotIds: string[];
    citedFacts: string[];
    recruiterNotes?: string;
  } | null;
  recipient: string | null;
  proposedSlots: { id: string; localStart: string; interviewer: string; durationMinutes: number }[];
  warnings: string[];
  violations: string[];
  error: { code: string; message: string } | null;
  messageId: string | null;
  createdAt: string;
  events?: RunEventDto[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function createApi(token: string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, json?.error?.message ?? res.statusText, json?.error?.details);
    }
    return json as T;
  }

  return {
    candidates: () => request<{ candidates: CandidateDto[] }>('GET', '/api/candidates'),
    jobs: () => request<{ jobs: JobDto[] }>('GET', '/api/jobs'),
    runs: () => request<{ runs: RunDto[] }>('GET', '/api/runs'),
    run: (id: string) => request<{ run: RunDto }>('GET', `/api/runs/${id}`),
    createRun: (body: { candidateId: string; jobId: string; note?: string }) =>
      request<{ run: RunDto }>('POST', '/api/runs', body),
    approve: (id: string, edits: { subject?: string; body?: string }) =>
      request<{ run: RunDto }>('POST', `/api/runs/${id}/approve`, edits),
    reject: (id: string, reason: string) =>
      request<{ run: RunDto }>('POST', `/api/runs/${id}/reject`, { reason }),
  };
}
