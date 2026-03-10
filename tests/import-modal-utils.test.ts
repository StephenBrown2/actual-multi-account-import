import { describe, expect, test } from "bun:test";

import {
  applyFieldMappings,
  parseAmountFields,
  parseDate,
  stripCsvImportTransaction,
} from "../web/src/importModal/utils";

describe("parseDate", () => {
  test("parses multiple date formats", () => {
    expect(parseDate("2026-03-10", "yyyy mm dd")).toBe("2026-03-10");
    expect(parseDate("03/10/2026", "mm dd yyyy")).toBe("2026-03-10");
    expect(parseDate("10/03/26", "dd mm yy")).toBe("2026-03-10");
    expect(parseDate("Mar 10 2026", "mm dd yyyy")).toBe("2026-03-10");
  });

  test("returns null for invalid input", () => {
    expect(parseDate(123, "yyyy mm dd")).toBeNull();
    expect(parseDate("not-a-date", "yyyy mm dd")).toBeNull();
  });
});

describe("applyFieldMappings", () => {
  test("maps fields and defaults selected to true", () => {
    expect(
      applyFieldMappings(
        { trx_id: "txn-1", Date: "2026-03-10", Merchant: "Coffee" },
        {
          date: "Date",
          amount: null,
          payee: "Merchant",
          notes: null,
          category: null,
          inOut: null,
          inflow: null,
          outflow: null,
          account: null,
          importedId: null,
        },
      ),
    ).toEqual({
      trx_id: "txn-1",
      selected: true,
      date: "2026-03-10",
      payee_name: "Coffee",
    });
  });
});

describe("parseAmountFields", () => {
  test("handles in/out mode with negative outflow", () => {
    expect(
      parseAmountFields({ amount: "12.34", inOut: "debit" }, false, true, "debit", false, "1"),
    ).toEqual({
      amount: -12.34,
      outflow: null,
      inflow: null,
    });
  });

  test("handles split mode and multiplier", () => {
    expect(
      parseAmountFields({ inflow: "10.00", outflow: "" }, true, false, "", false, "0.5"),
    ).toEqual({
      amount: 5,
      outflow: 0,
      inflow: 5,
    });
  });

  test("flips amount direction", () => {
    expect(parseAmountFields({ amount: "8.00" }, false, false, "", true, "1")).toEqual({
      amount: -8,
      outflow: null,
      inflow: null,
    });
  });
});

describe("stripCsvImportTransaction", () => {
  test("removes internal metadata fields", () => {
    expect(
      stripCsvImportTransaction({
        trx_id: "txn-1",
        selected: false,
        date: "2026-03-10",
        amount: 12,
      }),
    ).toEqual({
      date: "2026-03-10",
      amount: 12,
    });
  });
});
