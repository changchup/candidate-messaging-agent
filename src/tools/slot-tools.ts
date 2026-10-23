import { z } from 'zod';
import type { Repository } from '../data/dataset.ts';
import { err, ok, type ToolResult } from './result.ts';

/** Simulates the interview-calendar service. Returns untyped JSON like a real HTTP client would. */
export interface SlotSource {
  fetchSlots(jobId: string): Promise<unknown>;
}

const WireSlot = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  interviewer: z.string().min(1),
});
const WireSlots = z.array(WireSlot);

export function createSlotSource(repository: Repository, mode: 'valid' | 'malformed'): SlotSource {
  return {
    async fetchSlots(jobId) {
      if (mode === 'malformed') {
        // e.g. an upstream deploy changed the payload shape
        return [{ slot: 's-101', start: 'next Tuesday-ish', duration: 'forty-five' }];
      }
      return repository.listSlots(jobId).map((s) => ({ ...s, startsAt: s.startsAt.toISOString() }));
    },
  };
}

export const GetInterviewSlotsInput = z.object({
  jobId: z.string().min(1),
  timezone: z.string().min(1).optional(),
});

export interface SlotView {
  id: string;
  jobId: string;
  startsAt: string;
  durationMinutes: number;
  interviewer: string;
  /** Human-readable start in the requested timezone (or UTC). */
  localStart: string;
}

export function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function createGetInterviewSlots(deps: { slotSource: SlotSource; now: () => Date }) {
  return async (input: z.infer<typeof GetInterviewSlotsInput>): Promise<ToolResult<SlotView[]>> => {
    const raw = await deps.slotSource.fetchSlots(input.jobId);
    const parsed = WireSlots.safeParse(raw);
    if (!parsed.success) {
      return err(
        'INVALID_UPSTREAM_RESPONSE',
        'Calendar service returned data in an unexpected format; slots are unavailable.',
      );
    }
    const timeZone = input.timezone ?? 'UTC';
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone });
    } catch {
      return err('INVALID_INPUT', `Unknown timezone ${timeZone}`);
    }
    const now = deps.now().getTime();
    return ok(
      parsed.data
        .filter((s) => new Date(s.startsAt).getTime() > now)
        .map((s) => ({ ...s, localStart: formatInZone(new Date(s.startsAt), timeZone) })),
    );
  };
}
