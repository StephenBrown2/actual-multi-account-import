import { z } from "zod";

import type { AmountOptions, FieldMapping, ParseFileOptions } from "../types";

export type CliOptions = {
  serverUrl?: string;
  password?: string;
  sessionToken?: string;
  dataDir?: string;
  budgetId?: string;
  budgetName?: string;
  syncId?: string;
  defaultAccount?: string;
  accountColumn?: string;
  mapAccount?: string[];
  mapField?: string[];
  hasHeader: boolean;
  delimiter?: string;
  skipStartLines?: string;
  skipEndLines?: string;
  importNotes: boolean;
  fallbackMissingPayeeToMemo: boolean;
  dryRun: boolean;
  allowPartial: boolean;
  json: boolean;
  inOutMode?: boolean;
  outValue?: string;
  splitMode?: boolean;
  flipAmount?: boolean;
  multiplierAmount?: string;
  before?: string;
  after?: string;
};

export const cliOptionsSchema = z
  .object({
    serverUrl: z.string().min(1),
    password: z.string().optional(),
    sessionToken: z.string().optional(),
    dataDir: z.string().optional(),
    budgetId: z.string().optional(),
    budgetName: z.string().optional(),
    syncId: z.string().optional(),
    defaultAccount: z.string().optional(),
    accountColumn: z.string().optional(),
    mapAccount: z.array(z.string()).default([]),
    mapField: z.array(z.string()).default([]),
    hasHeader: z.boolean(),
    delimiter: z.string().optional(),
    skipStartLines: z.string().optional(),
    skipEndLines: z.string().optional(),
    importNotes: z.boolean(),
    fallbackMissingPayeeToMemo: z.boolean(),
    dryRun: z.boolean(),
    allowPartial: z.boolean(),
    json: z.boolean(),
    inOutMode: z.boolean().optional(),
    outValue: z.string().optional(),
    splitMode: z.boolean().optional(),
    flipAmount: z.boolean().optional(),
    multiplierAmount: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .superRefine((options, ctx) => {
    if (!options.password && !options.sessionToken) {
      ctx.addIssue({
        code: "custom",
        message:
          "Authentication required. Provide either --password <password> or --session-token <token> to connect to the Actual server.",
      });
    }
  });

export const fileArgumentSchema = z.string().min(1, "Import file path is required.");
export const directoryArgumentSchema = z.string().min(1, "Watch directory path is required.");

export type ValidatedCliOptions = z.infer<typeof cliOptionsSchema>;

export function withEnvFallback(options: CliOptions): CliOptions {
  return {
    ...options,
    serverUrl: options.serverUrl ?? process.env.ACTUAL_SERVER_URL,
    password: options.password ?? process.env.ACTUAL_PASSWORD,
    sessionToken: options.sessionToken ?? process.env.ACTUAL_SESSION_TOKEN,
    dataDir: options.dataDir ?? process.env.ACTUAL_DATA_DIR,
    budgetId: options.budgetId ?? process.env.ACTUAL_BUDGET_ID,
    budgetName: options.budgetName ?? process.env.ACTUAL_BUDGET_NAME,
    syncId: options.syncId ?? process.env.ACTUAL_SYNC_ID,
  };
}

export function assertRequiredOptions(
  options: CliOptions,
): asserts options is CliOptions & { serverUrl: string } {
  if (!options.serverUrl) {
    throw new Error(
      "Actual server URL required. Provide --server-url <url> or set ACTUAL_SERVER_URL in the environment.",
    );
  }
}

export function parseKeyValue(items: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items ?? []) {
    const idx = item.indexOf("=");
    if (idx <= 0 || idx === item.length - 1) {
      throw new Error(
        `Invalid mapping "${item}". Use KEY=VALUE format (e.g. --map-account "Checking=abc123" or --map-field "date=Transaction Date").`,
      );
    }
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

export function parseFieldMapping(
  raw: Record<string, string>,
  accountColumn?: string,
): FieldMapping {
  return {
    date: raw.date,
    amount: raw.amount,
    inflow: raw.inflow,
    outflow: raw.outflow,
    inOut: raw.inOut,
    payeeName: raw.payee ?? raw.payeeName,
    importedPayee: raw.importedPayee,
    notes: raw.notes,
    importedId: raw.importedId ?? raw.imported_id,
    account: raw.account ?? accountColumn,
    cleared: raw.cleared,
  };
}

export function parseAmountOptions(options: CliOptions): AmountOptions | undefined {
  const hasAny =
    options.inOutMode ||
    options.splitMode ||
    options.flipAmount ||
    (options.multiplierAmount && options.multiplierAmount !== "1");
  if (!hasAny) return undefined;
  return {
    splitMode: options.splitMode,
    inOutMode: options.inOutMode,
    outValue: options.outValue,
    flipAmount: options.flipAmount,
    multiplierAmount: options.multiplierAmount,
  };
}

function intOption(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parseFileOptions(options: CliOptions): ParseFileOptions {
  return {
    hasHeaderRow: options.hasHeader,
    delimiter: options.delimiter,
    fallbackMissingPayeeToMemo: options.fallbackMissingPayeeToMemo,
    skipStartLines: intOption(options.skipStartLines),
    skipEndLines: intOption(options.skipEndLines),
    importNotes: options.importNotes,
  };
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function readOptionalFlag(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

export function normalizeCliOptions(rawOptions: Record<string, unknown>): CliOptions {
  return {
    serverUrl: readOptionalString(rawOptions.serverUrl),
    password: readOptionalString(rawOptions.password),
    sessionToken: readOptionalString(rawOptions.sessionToken),
    dataDir: readOptionalString(rawOptions.dataDir),
    budgetId: readOptionalString(rawOptions.budgetId),
    budgetName: readOptionalString(rawOptions.budgetName),
    syncId: readOptionalString(rawOptions.syncId),
    defaultAccount: readOptionalString(rawOptions.defaultAccount),
    accountColumn: readOptionalString(rawOptions.accountColumn),
    mapAccount: readStringArray(rawOptions.mapAccount),
    mapField: readStringArray(rawOptions.mapField),
    hasHeader: rawOptions.hasHeader !== false,
    delimiter: readOptionalString(rawOptions.delimiter),
    skipStartLines: readOptionalString(rawOptions.skipStartLines),
    skipEndLines: readOptionalString(rawOptions.skipEndLines),
    importNotes: rawOptions.importNotes !== false,
    fallbackMissingPayeeToMemo: rawOptions.fallbackMissingPayeeToMemo === true,
    dryRun: rawOptions.dryRun === true,
    allowPartial: rawOptions.allowPartial === true,
    json: rawOptions.json === true,
    inOutMode: readOptionalFlag(rawOptions.inOutMode),
    outValue: readOptionalString(rawOptions.outValue),
    splitMode: readOptionalFlag(rawOptions.splitMode),
    flipAmount: readOptionalFlag(rawOptions.flipAmount),
    multiplierAmount: readOptionalString(rawOptions.multiplierAmount) ?? "1",
    before: readOptionalString(rawOptions.before),
    after: readOptionalString(rawOptions.after),
  };
}

export function validateCliOptions(options: CliOptions): ValidatedCliOptions {
  const normalized = withEnvFallback(options);
  assertRequiredOptions(normalized);
  return cliOptionsSchema.parse(normalized);
}
