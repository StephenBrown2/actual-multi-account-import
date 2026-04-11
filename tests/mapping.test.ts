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

  test("supports explicit account map targets by account name", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Amount: "2.50",
          SourceAcct: "HOUSE",
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        amount: "Amount",
        account: "SourceAcct",
      },
      accountValueMap: { HOUSE: "Savings" },
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.byAccountId.get("acct-savings")).toHaveLength(1);
  });

  test("normalizes account map keys and account names for matching", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Amount: "2.50",
          SourceAcct: "SoFi   Savings\u00A0Account",
        },
      },
    ];

    const normalizedAccounts = [...accounts, { id: "acct-sofi", name: "SoFi Savings Account" }];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        amount: "Amount",
        account: "SourceAcct",
      },
      accountValueMap: { "sofi savings account": "SoFi Savings Account" },
    };

    const result = mapRowsForImport(rows, normalizedAccounts, request);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.byAccountId.get("acct-sofi")).toHaveLength(1);
  });

  test("applies in/out mode, cleared parsing, and notes mapping", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Amount: "12.34",
          Direction: "Debit",
          Status: "yes",
          Memo: "Coffee",
          AccountName: "Checking",
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        amount: "Amount",
        inOut: "Direction",
        notes: "Memo",
        cleared: "Status",
        account: "AccountName",
      },
      amountOptions: {
        inOutMode: true,
        outValue: "debit",
      },
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.byAccountId.get("acct-checking")).toEqual([
      {
        date: "2026-02-01",
        amount: -1234,
        notes: "Coffee",
        cleared: true,
      },
    ]);
  });

  test("applies split mode, flip amount, and multiplier", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Inflow: "10.00",
          Outflow: "",
          AccountName: "Checking",
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        inflow: "Inflow",
        outflow: "Outflow",
        account: "AccountName",
      },
      amountOptions: {
        splitMode: true,
        flipAmount: true,
        multiplierAmount: "0.5",
      },
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.byAccountId.get("acct-checking")).toEqual([
      {
        date: "2026-02-01",
        amount: -500,
      },
    ]);
  });

  test("maps structured rows using embedded account value", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        raw: {},
        structured: {
          date: "2026-02-01",
          amount: 12.34,
          payee_name: "Coffee",
          account: "Savings",
          cleared: false,
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {},
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.byAccountId.get("acct-savings")).toEqual([
      {
        date: "2026-02-01",
        amount: 1234,
        payee_name: "Coffee",
        cleared: false,
      },
    ]);
  });

  test("reports invalid row and unresolved account errors", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "invalid-date",
          Amount: "12.34",
          AccountName: "Checking",
        },
      },
      {
        rowNumber: 2,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Amount: "12.34",
          AccountName: "Unknown",
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        amount: "Amount",
        account: "AccountName",
      },
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.byAccountId.size).toBe(0);
    expect(result.rowErrors).toEqual([
      {
        rowNumber: 1,
        message: "Could not build a valid transaction from this row",
      },
      {
        rowNumber: 2,
        message: 'Could not resolve account for value "Unknown"',
      },
    ]);
  });

  test("includes closest account hints for unresolved values", () => {
    const rows: NormalizedRow[] = [
      {
        rowNumber: 1,
        structured: null,
        raw: {
          Date: "2026-02-01",
          Amount: "12.34",
          AccountName: "Savings Account",
        },
      },
    ];

    const request: MappingRequest = {
      fieldMapping: {
        date: "Date",
        amount: "Amount",
        account: "AccountName",
      },
    };

    const result = mapRowsForImport(rows, accounts, request);
    expect(result.byAccountId.size).toBe(0);
    expect(result.rowErrors).toEqual([
      {
        rowNumber: 1,
        message: 'Could not resolve account for value "Savings Account" (closest: Savings)',
      },
    ]);
  });
});
