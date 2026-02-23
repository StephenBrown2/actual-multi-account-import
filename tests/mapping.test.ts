import { describe, expect, test } from "bun:test";

import { mapRowsForImport } from "../src/import/mapping";
import type { MappingRequest, NormalizedRow } from "../src/types";

const accounts = [
  { id: "acct-checking", name: "Checking" },
  { id: "acct-savings", name: "Savings" },
];

describe("mapRowsForImport", () => {
  test("maps delimited rows to per-account groups", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Amount: "12.34",
          Description: "Coffee",
          AccountName: "Checking",
        },
      },
      {
        rowNumber: 2,
        structured: null,
        raw: {
          Date: "2026-02-02",
          Amount: "10.00",
          Description: "Transfer in",
          AccountName: "Savings",
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        amount: "Amount",
        payeeName: "Description",
        account: "AccountName",
      },
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.byAccountId.get("acct-checking")).toHaveLength(1);
    expect(result.byAccountId.get("acct-savings")).toHaveLength(1);
  });

  test("uses explicit account value map and default account", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Amount: "2.50",
          SourceAcct: "CHK",
        },
      },
      {
        rowNumber: 2,
        structured: null,
        raw: {
          Date: "2026-02-02",
          Amount: "4.75",
          SourceAcct: "",
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        amount: "Amount",
        account: "SourceAcct",
      },
      accountValueMap: { CHK: "acct-checking" },
      defaultAccountId: "acct-savings",
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.byAccountId.get("acct-checking")).toHaveLength(1);
    expect(result.byAccountId.get("acct-savings")).toHaveLength(1);
  });
});
