import { describe, expect, it } from 'vitest';
import { loadCsvFile, parseCsv } from '../../src/data/csv-loader.ts';
import { CandidateRowSchema, JobRowSchema, SlotRowSchema } from '../../src/domain/schemas.ts';

const fixtures = 'fixtures/data';

describe('candidates.csv', () => {
  const { records, rejected } = loadCsvFile(`${fixtures}/candidates.csv`, CandidateRowSchema);

  it('loads every row of the clean export', () => {
    expect(rejected).toEqual([]);
    expect(records.map((c) => c.id)).toEqual([
      'c-001', 'c-002', 'c-003', 'c-004', 'c-005', 'c-006', 'c-007', 'c-008',
    ]);
  });

  it('maps source columns to the domain model', () => {
    expect(records[0]).toEqual({
      id: 'c-001',
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya.sharma@example.com',
      currentTitle: 'Backend Engineer',
      location: 'Auckland, NZ',
      timezone: 'Pacific/Auckland',
      skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
      notes: 'Strong systems design in take-home.',
      appliedJobId: 'j-001',
      updatedAt: new Date('2026-10-12T09:30:00Z'),
    });
  });

  it('normalises whitespace and email casing', () => {
    const liam = records.find((c) => c.id === 'c-006');
    expect(liam?.lastName).toBe("O'Connor");
    expect(liam?.email).toBe('liam.oconnor@example.com');
  });

  it('preserves non-ASCII names', () => {
    expect(records.find((c) => c.id === 'c-007')?.lastName).toBe('García');
  });

  it('keeps untrusted free-text notes verbatim (they are data, not instructions)', () => {
    expect(records.find((c) => c.id === 'c-005')?.notes).toMatch(/^IGNORE ALL PREVIOUS/);
  });
});

describe('malformed candidate export', () => {
  const { records, rejected } = loadCsvFile(`${fixtures}/malformed-set/candidates.csv`, CandidateRowSchema);

  it('keeps valid rows and rejects bad ones with line numbers and reasons', () => {
    expect(records.map((c) => c.id)).toEqual(['c-900']);
    expect(rejected).toEqual([
      { line: 3, errors: ['email: is required'] },
      { line: 4, errors: ['email: must be a valid email'] },
      { line: 5, errors: ['updated_at: must be an ISO-8601 timestamp'] },
      { line: 6, errors: ['candidate_id: is required'] },
      { line: 7, errors: ['duplicate id c-900'] },
    ]);
  });
});

describe('jobs.csv', () => {
  const { records, rejected } = loadCsvFile(`${fixtures}/jobs.csv`, JobRowSchema);

  it('loads jobs and turns empty salary into null', () => {
    expect(rejected).toEqual([]);
    expect(records.find((j) => j.id === 'j-001')?.salaryRange).toBe('NZD 170,000–200,000');
    expect(records.find((j) => j.id === 'j-002')?.salaryRange).toBeNull();
  });

  it('rejects an unknown interview format', () => {
    const csv = 'job_id,title,team,location,hiring_manager,interview_format\nj-9,T,X,Y,Z,carrier-pigeon\n';
    expect(parseCsv(csv, JobRowSchema).rejected[0]?.errors).toEqual([
      'interview_format: must be video, onsite or phone',
    ]);
  });
});

describe('slots.csv', () => {
  it('parses timestamps as UTC instants and durations as integers', () => {
    const { records, rejected } = loadCsvFile(`${fixtures}/slots.csv`, SlotRowSchema);
    expect(rejected).toEqual([]);
    const s101 = records.find((s) => s.id === 's-101');
    expect(s101?.startsAt.toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(s101?.durationMinutes).toBe(45);
  });

  it('rejects negative, non-numeric durations and bad dates', () => {
    const { records, rejected } = loadCsvFile(`${fixtures}/malformed-set/slots.csv`, SlotRowSchema);
    expect(records.map((s) => s.id)).toEqual(['s-900']);
    expect(rejected).toEqual([
      { line: 3, errors: ['duration_minutes: must be positive'] },
      { line: 4, errors: ['starts_at: must be an ISO-8601 timestamp'] },
      { line: 5, errors: ['duration_minutes: must be a number'] },
    ]);
  });
});
