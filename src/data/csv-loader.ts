import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export interface RejectedRow {
  /** 1-based line number in the source file (header is line 1). */
  line: number;
  errors: string[];
}

export interface LoadResult<T> {
  records: T[];
  rejected: RejectedRow[];
}

/**
 * Parse CSV text into validated records. Invalid rows are collected with reasons rather than
 * failing the whole load, so a partially bad export still yields usable data plus a report.
 */
export function parseCsv<S extends z.ZodType<{ id: string }>>(
  text: string,
  schema: S,
): LoadResult<z.output<S>> {
  const rows: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });
  const records: z.output<S>[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const line = i + 2;
    const result = schema.safeParse(row);
    if (!result.success) {
      rejected.push({
        line,
        errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
      return;
    }
    if (seen.has(result.data.id)) {
      rejected.push({ line, errors: [`duplicate id ${result.data.id}`] });
      return;
    }
    seen.add(result.data.id);
    records.push(result.data);
  });

  return { records, rejected };
}

export function loadCsvFile<S extends z.ZodType<{ id: string }>>(path: string, schema: S) {
  return parseCsv(readFileSync(path, 'utf8'), schema);
}
