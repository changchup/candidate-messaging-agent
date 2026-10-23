import { describe, expect, it } from 'vitest';
import { createGetCandidate, createGetJob } from '../../src/tools/candidate-tools.ts';
import { createGetInterviewSlots, createSlotSource } from '../../src/tools/slot-tools.ts';
import { createMockEmailProvider, createSendMessage } from '../../src/tools/email-provider.ts';
import { fixedClock, fixtureRepository } from '../helpers/fixtures.ts';

const repository = fixtureRepository();

describe('get_candidate', () => {
  const getCandidate = createGetCandidate({ repository, now: fixedClock });

  it('returns a fresh candidate with stale=false', async () => {
    const res = await getCandidate({ candidateId: 'c-001' });
    expect(res).toMatchObject({
      ok: true,
      data: { firstName: 'Priya', daysSinceUpdate: 11, stale: false },
    });
  });

  it('flags candidates not updated for more than 90 days as stale', async () => {
    const res = await getCandidate({ candidateId: 'c-003' });
    expect(res).toMatchObject({ ok: true, data: { stale: true } });
  });

  it('returns NOT_FOUND for unknown ids', async () => {
    expect(await getCandidate({ candidateId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', retryable: false },
    });
  });
});

describe('get_job', () => {
  const getJob = createGetJob({ repository });

  it('returns the job', async () => {
    expect(await getJob({ jobId: 'j-002' })).toMatchObject({
      ok: true,
      data: { title: 'Platform Engineer' },
    });
  });

  it('returns NOT_FOUND for unknown ids', async () => {
    expect(await getJob({ jobId: 'j-999' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('get_interview_slots', () => {
  const getSlots = createGetInterviewSlots({
    slotSource: createSlotSource(repository, 'valid'),
    now: fixedClock,
  });

  it('returns only future slots, in start order', async () => {
    const res = await getSlots({ jobId: 'j-001' });
    expect(res.ok && res.data.map((s) => s.id)).toEqual(['s-101', 's-102', 's-103']);
  });

  it('formats local start time in the requested timezone', async () => {
    const res = await getSlots({ jobId: 'j-001', timezone: 'Pacific/Auckland' });
    // 2026-10-28T21:00Z is 10:00 on Thursday 29 Oct in Auckland (NZDT, UTC+13)
    expect(res.ok && res.data[0]?.localStart).toMatch(/Thursday.*29 October.*10:00/);
  });

  it('returns an empty list when every slot is in the past', async () => {
    expect(await getSlots({ jobId: 'j-004' })).toEqual({ ok: true, data: [] });
  });

  it('rejects unknown timezones', async () => {
    expect(await getSlots({ jobId: 'j-001', timezone: 'Mars/Olympus' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('returns INVALID_UPSTREAM_RESPONSE when the calendar payload is malformed', async () => {
    const broken = createGetInterviewSlots({
      slotSource: createSlotSource(repository, 'malformed'),
      now: fixedClock,
    });
    expect(await broken({ jobId: 'j-001' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_UPSTREAM_RESPONSE' },
    });
  });
});

describe('send_message', () => {
  const msg = { to: 'a@example.com', subject: 'Hi', body: 'Hello' };

  it('sends via the provider and records the message in the outbox', async () => {
    const provider = createMockEmailProvider({ status: () => 'up' });
    const res = await createSendMessage({ provider })(msg);
    expect(res).toEqual({ ok: true, data: { messageId: 'msg-1' } });
    expect(provider.outbox).toHaveLength(1);
  });

  it('returns a retryable PROVIDER_UNAVAILABLE error when the provider is down', async () => {
    const provider = createMockEmailProvider({ status: () => 'down' });
    const res = await createSendMessage({ provider })(msg);
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
    });
    expect(provider.outbox).toHaveLength(0);
  });
});
