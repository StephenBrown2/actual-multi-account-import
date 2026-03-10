import { describe, expect, test } from "bun:test";

import { buildPreviewPayload, normalizeParsedTransactions } from "../src/import/parse";
import type { ParseError } from "../src/types";

describe("normalizeParsedTransactions", () => {
  test("normalizes structured, object, and array rows", () => {
    expect(
      normalizeParsedTransactions([
        { date: "2026-03-10", amount: 12.34, payee_name: "Coffee" },
        { Date: "2026-03-11", Amount: "5.00" },
        ["2026-03-12", "7.50"],
      ]),
    ).toEqual([
      {
        rowNumber: 1,
        raw: {},
        structured: { date: "2026-03-10", amount: 12.34, payee_name: "Coffee" },
      },
      {
        rowNumber: 2,
        raw: { Date: "2026-03-11", Amount: "5.00" },
        structured: null,
      },
      {
        rowNumber: 3,
        raw: { column_1: "2026-03-12", column_2: "7.50" },
        structured: null,
      },
    ]);
  });

  test("returns empty list for missing transactions", () => {
    expect(normalizeParsedTransactions(undefined)).toEqual([]);
  });
});

describe("buildPreviewPayload", () => {
  test("infers columns, mappings, account values, and sample rows", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      rowNumber: index + 1,
      structured: null,
      raw: {
        Date: `2026-03-${String((index % 9) + 1).padStart(2, "0")}`,
        Amount: String(index + 1),
        Merchant: `Merchant ${index + 1}`,
        Account: index % 2 === 0 ? "Checking" : "Savings",
      },
    }));
    const errors: ParseError[] = [{ message: "warn", internal: "debug" }];

    const preview = buildPreviewPayload(rows, errors, "csv");

    expect(preview.columns).toEqual(["Date", "Amount", "Merchant", "Account"]);
    expect(preview.inferredMapping).toEqual({
      date: "Date",
      amount: "Amount",
      payeeName: "Merchant",
      account: "Account",
    });
    expect(preview.uniqueAccountValues).toEqual(["Checking", "Savings"]);
    expect(preview.sampleRows).toHaveLength(25);
    expect(preview.totalRows).toBe(30);
    expect(preview.errors).toEqual(errors);
  });
});
