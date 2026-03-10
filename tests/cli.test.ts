import { afterEach, describe, expect, test } from "bun:test";
import type { FSWatcher, WatchListener, WatchOptions } from "node:fs";
import { join } from "node:path";

import {
  assertRequiredOptions,
  buildProgram,
  collect,
  parseAmountOptions,
  parseFieldMapping,
  parseFileOptions,
  parseKeyValue,
  withEnvFallback,
} from "../src/cli";
import type { CliOptions } from "../src/cli";

const ENV_KEYS = [
  "ACTUAL_SERVER_URL",
  "ACTUAL_PASSWORD",
  "ACTUAL_SESSION_TOKEN",
  "ACTUAL_DATA_DIR",
  "ACTUAL_BUDGET_ID",
  "ACTUAL_BUDGET_NAME",
  "ACTUAL_SYNC_ID",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function baseOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    hasHeader: true,
    importNotes: true,
    fallbackMissingPayeeToMemo: false,
    dryRun: false,
    allowPartial: false,
    json: false,
    ...overrides,
  };
}

function createWatcherStub(): FSWatcher {
  return {
    close() {},
    ref() {
      return this;
    },
    unref() {
      return this;
    },
  } as FSWatcher;
}

function createWatchStub(
  callback?: (listener: WatchListener<string>) => void,
): typeof import("node:fs").watch {
  return ((
    _filename: Parameters<typeof import("node:fs").watch>[0],
    _options?: WatchOptions | BufferEncoding | null,
    listener?: WatchListener<string>,
  ) => {
    if (listener && callback) {
      callback(listener);
    }
    return createWatcherStub();
  }) as unknown as typeof import("node:fs").watch;
}

describe("cli helpers", () => {
  test("withEnvFallback fills missing values from environment only", () => {
    process.env.ACTUAL_SERVER_URL = "https://env.example";
    process.env.ACTUAL_PASSWORD = "env-password";
    process.env.ACTUAL_BUDGET_NAME = "Env Budget";

    const result = withEnvFallback(
      baseOptions({ serverUrl: "https://explicit.example", budgetName: undefined }),
    );

    expect(result.serverUrl).toBe("https://explicit.example");
    expect(result.password).toBe("env-password");
    expect(result.budgetName).toBe("Env Budget");
  });

  test("assertRequiredOptions throws when server url is missing", () => {
    expect(() => assertRequiredOptions(baseOptions())).toThrow(
      "Actual server URL required. Provide --server-url <url> or set ACTUAL_SERVER_URL in the environment.",
    );
  });

  test("parseKeyValue trims keys and values", () => {
    expect(parseKeyValue([" date = Transaction Date ", "amount= Amount "])).toEqual({
      date: "Transaction Date",
      amount: "Amount",
    });
  });

  test("parseKeyValue rejects invalid mappings", () => {
    expect(() => parseKeyValue(["broken"])).toThrow('Invalid mapping "broken"');
  });

  test("parseFieldMapping applies aliases and account fallback", () => {
    expect(
      parseFieldMapping({ payee: "Merchant", imported_id: "Id", amount: "Amount" }, "Acct"),
    ).toEqual({
      date: undefined,
      amount: "Amount",
      inflow: undefined,
      outflow: undefined,
      inOut: undefined,
      payeeName: "Merchant",
      importedPayee: undefined,
      notes: undefined,
      importedId: "Id",
      account: "Acct",
      cleared: undefined,
    });
  });

  test("parseAmountOptions ignores default state and returns configured state", () => {
    expect(parseAmountOptions(baseOptions({ multiplierAmount: "1" }))).toBeUndefined();
    expect(
      parseAmountOptions(
        baseOptions({
          inOutMode: true,
          outValue: "debit",
          flipAmount: true,
          multiplierAmount: "0.5",
        }),
      ),
    ).toEqual({
      splitMode: undefined,
      inOutMode: true,
      outValue: "debit",
      flipAmount: true,
      multiplierAmount: "0.5",
    });
  });

  test("parseFileOptions converts integer-like values and preserves flags", () => {
    expect(
      parseFileOptions(
        baseOptions({
          delimiter: ";",
          skipStartLines: "2",
          skipEndLines: "3",
          fallbackMissingPayeeToMemo: true,
          importNotes: false,
        }),
      ),
    ).toEqual({
      hasHeaderRow: true,
      delimiter: ";",
      fallbackMissingPayeeToMemo: true,
      skipStartLines: 2,
      skipEndLines: 3,
      importNotes: false,
    });
  });

  test("collect appends repeated option values", () => {
    expect(collect("b", ["a"])).toEqual(["a", "b"]);
  });
});

describe("buildProgram", () => {
  test("uses env fallback for root import command", async () => {
    process.env.ACTUAL_SERVER_URL = "https://env.example";
    process.env.ACTUAL_PASSWORD = "env-password";

    const calls: Array<{ file: string; options: CliOptions & { serverUrl: string } }> = [];
    const program = buildProgram({
      runImport: async (file, options) => {
        calls.push({ file, options });
        return null;
      },
      closeActual: async () => {},
      existsSync: () => true,
      watch: createWatchStub(),
      formatForUser: (error) => String(error),
      log: () => {},
      error: () => {},
      waitUntilStopped: async () => {},
    });

    await program.parseAsync(["node", "cli", "/imports/file.csv"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: "/imports/file.csv",
      options: expect.objectContaining({
        serverUrl: "https://env.example",
        password: "env-password",
      }),
    });
  });

  test("watch command merges global options and triggers import for supported files", async () => {
    const calls: Array<{ file: string; options: CliOptions & { serverUrl: string } }> = [];
    const logs: string[] = [];
    const program = buildProgram({
      runImport: async (file, options) => {
        calls.push({ file, options });
        return null;
      },
      closeActual: async () => {},
      existsSync: () => true,
      watch: createWatchStub((listener) => {
        void listener("rename", "sample.csv");
        void listener("rename", "ignored.txt");
      }),
      formatForUser: (error) => String(error),
      log: (...args) => logs.push(args.join(" ")),
      error: () => {},
      waitUntilStopped: async () => {},
    });

    await program.parseAsync([
      "node",
      "cli",
      "watch",
      "/imports",
      "--server-url=https://example.com",
      "--password=secret",
      "--budget-name=Budget",
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: join("/imports", "sample.csv"),
      options: expect.objectContaining({
        serverUrl: "https://example.com",
        password: "secret",
        budgetName: "Budget",
      }),
    });
    expect(logs[0]).toContain("Watching /imports");
  });
});
