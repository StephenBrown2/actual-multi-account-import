import type { NormalizedRow } from "../types";

export type DateFilterOptions = {
  beforeDate?: string;
  afterDate?: string;
};

export type DateFilterResult = {
  rows: NormalizedRow[];
  excludedCount: number;
  warnings: string[];
  appliedBeforeDate?: string;
  appliedAfterDate?: string;
};

function toIsoDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }
  const normalized = date.toISOString().slice(0, 10);
  return normalized === trimmed ? trimmed : undefined;
}

function normalizeRowDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const strictIso = toIsoDate(trimmed);
  if (strictIso) {
    return strictIso;
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 10);
}

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function applyDateFilter(
  rows: NormalizedRow[],
  dateField: string | undefined,
  options: DateFilterOptions,
): DateFilterResult {
  const warnings: string[] = [];

  const beforeDate = options.beforeDate ? toIsoDate(options.beforeDate) : undefined;
  const afterDate = options.afterDate ? toIsoDate(options.afterDate) : undefined;

  if (options.beforeDate && !beforeDate) {
    warnings.push(`Ignoring invalid --before date "${options.beforeDate}" (expected YYYY-MM-DD).`);
  }
  if (options.afterDate && !afterDate) {
    warnings.push(`Ignoring invalid --after date "${options.afterDate}" (expected YYYY-MM-DD).`);
  }

  if (!beforeDate && !afterDate) {
    return {
      rows,
      excludedCount: 0,
      warnings,
    };
  }

  const today = getTodayIsoDate();
  if (beforeDate && beforeDate > today) {
    warnings.push(
      `Date filter warning: before date ${beforeDate} is in the future relative to today (${today}).`,
    );
  }
  if (afterDate && afterDate > today) {
    warnings.push(
      `Date filter warning: after date ${afterDate} is in the future relative to today (${today}).`,
    );
  }
  if (beforeDate && afterDate && beforeDate < afterDate) {
    warnings.push(
      `Date filter warning: before date ${beforeDate} is earlier than after date ${afterDate}; this range may exclude all dated rows.`,
    );
  }

  const kept: NormalizedRow[] = [];
  let excludedCount = 0;
  let undatedCount = 0;

  for (const row of rows) {
    const rawDate = row.structured?.date ?? (dateField ? row.raw[dateField] : undefined);
    const normalizedDate = normalizeRowDate(rawDate);

    if (!normalizedDate) {
      undatedCount += 1;
      kept.push(row);
      continue;
    }

    if (afterDate && normalizedDate < afterDate) {
      excludedCount += 1;
      continue;
    }
    if (beforeDate && normalizedDate > beforeDate) {
      excludedCount += 1;
      continue;
    }

    kept.push(row);
  }

  if (undatedCount > 0 && (beforeDate || afterDate)) {
    warnings.push(
      `Date filter warning: ${undatedCount} row(s) had no parseable date and were not excluded by date filters.`,
    );
  }

  return {
    rows: kept,
    excludedCount,
    warnings,
    appliedBeforeDate: beforeDate,
    appliedAfterDate: afterDate,
  };
}
