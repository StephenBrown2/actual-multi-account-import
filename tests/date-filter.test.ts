import { describe, expect, test } from "bun:test";

import { applyDateFilter } from "../src/import/dateFilter";
import type { NormalizedRow } from "../src/types";

describe("applyDateFilter", () => {
  test("returns rows unchanged when no filters are provided", () => {
    const rows: NormalizedRow[] = [
      { rowNumber: 1, raw: { Date: "2026-01-01" }, structured: null },
      { rowNumber: 2, raw: { Date: "2026-01-02" }, structured: null },
    ];

    const result = applyDateFilter(rows, "Date", {});

    expect(result.rows).toHaveLength(2);
    expect(result.excludedCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("filters rows between after and before inclusive", () => {
    const rows: NormalizedRow[] = [
      { rowNumber: 1, raw: { Date: "2026-01-01" }, structured: null },
      { rowNumber: 2, raw: { Date: "2026-01-15" }, structured: null },
      { rowNumber: 3, raw: { Date: "2026-01-31" }, structured: null },
    ];

    const result = applyDateFilter(rows, "Date", {
      afterDate: "2026-01-10",
      beforeDate: "2026-01-20",
    });

    expect(result.rows.map((r) => r.rowNumber)).toEqual([2]);
    expect(result.excludedCount).toBe(2);
    expect(result.appliedAfterDate).toBe("2026-01-10");
    expect(result.appliedBeforeDate).toBe("2026-01-20");
  });

  test("supports structured-row dates", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        raw: {},
        structured: { date: "2026-02-01", amount: 10 },
      },
      {
        rowNumber: 2,
        raw: {},
        structured: { date: "2026-03-01", amount: 20 },
      },
    ];

    const result = applyDateFilter(rows, undefined, { beforeDate: "2026-02-15" });

    expect(result.rows.map((r) => r.rowNumber)).toEqual([1]);
    expect(result.excludedCount).toBe(1);
  });

  test("warns on invalid dates and conflicting ranges", () => {
    const rows: NormalizedRow[] = [{ rowNumber: 1, raw: { Date: "2026-01-10" }, structured: null }];

    const result = applyDateFilter(rows, "Date", {
      afterDate: "not-a-date",
      beforeDate: "2000-01-01",
    });

    expect(result.warnings.some((w) => w.includes("Ignoring invalid --after date"))).toBeTrue();
    expect(result.rows).toHaveLength(0);
    expect(result.excludedCount).toBe(1);
  });

  test("warns when rows are undated while filters are active", () => {
    const rows: NormalizedRow[] = [
      { rowNumber: 1, raw: { Date: "" }, structured: null },
      { rowNumber: 2, raw: { Date: "2026-01-01" }, structured: null },
    ];

    const result = applyDateFilter(rows, "Date", { afterDate: "2026-01-01" });

    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(
      result.warnings.some((w) => w.includes("had no parseable date and were not excluded")),
    ).toBeTrue();
  });
});
