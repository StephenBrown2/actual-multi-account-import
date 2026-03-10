import { describe, expect, test } from "bun:test";

import { resolveAccountByNameOrId } from "../src/import/accounts";

const accounts = [
  { id: "acct-checking", name: "Checking" },
  { id: "acct-savings", name: "Savings" },
];

describe("resolveAccountByNameOrId", () => {
  test("returns null for empty input", () => {
    expect(resolveAccountByNameOrId(accounts)).toBeNull();
    expect(resolveAccountByNameOrId(accounts, "")).toBeNull();
    expect(resolveAccountByNameOrId(accounts, "   ")).toBeNull();
  });

  test("matches by exact id before name", () => {
    expect(resolveAccountByNameOrId(accounts, "acct-checking")).toEqual(accounts[0]!);
  });

  test("matches by name case-insensitively and trims whitespace", () => {
    expect(resolveAccountByNameOrId(accounts, "  savings  ")).toEqual(accounts[1]!);
  });

  test("returns null for unknown value", () => {
    expect(resolveAccountByNameOrId(accounts, "brokerage")).toBeNull();
  });
});
