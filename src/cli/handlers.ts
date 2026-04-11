import { existsSync, watch } from "node:fs";
import { extname, join } from "node:path";

import {
  closeActual,
  importIntoAccount,
  initActual,
  isBudgetLoaded,
  listAccounts,
} from "../actual/client";
import { formatForUser } from "../errors";

const DEBUG = process.env.ACTUAL_IMPORT_DEBUG === "1" || process.env.ACTUAL_IMPORT_DEBUG === "true";
function debug(...args: unknown[]) {
  if (DEBUG) {
    const prefix = `[cli] ${new Date().toISOString()}`;
    console.error(prefix, ...args);
  }
}
import { resolveAccountByNameOrId } from "../import/accounts";
import { mapRowsForImport } from "../import/mapping";
import { buildPreviewPayload, parseAndNormalizeFile } from "../import/parse";
import type { MappingRequest } from "../types";
import {
  parseAmountOptions,
  parseFieldMapping,
  parseFileOptions,
  parseKeyValue,
  type ValidatedCliOptions,
} from "./options";

const WATCH_EXTENSIONS = new Set([".csv", ".tsv", ".qif", ".ofx", ".qfx", ".xml"]);

function normalizeAccountKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function collectAccountValues(
  rows: Array<{ raw: Record<string, string>; structured: { account?: string | null } | null }>,
  accountColumn?: string,
): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const fromStructured = row.structured?.account?.trim();
    if (fromStructured) {
      values.add(fromStructured);
      continue;
    }
    if (!accountColumn) {
      continue;
    }
    const fromRaw = row.raw[accountColumn]?.trim();
    if (fromRaw) {
      values.add(fromRaw);
    }
  }
  return Array.from(values.values());
}

function findClosestAccounts(value: string, accountNames: string[]): string[] {
  const normalized = normalizeAccountKey(value);
  if (!normalized) {
    return [];
  }

  const directContains = accountNames.filter((name) => {
    const account = normalizeAccountKey(name);
    return account.includes(normalized) || normalized.includes(account);
  });
  if (directContains.length > 0) {
    return directContains.slice(0, 3);
  }

  return accountNames
    .filter((name) => {
      const parts = normalizeAccountKey(name).split(" ").filter(Boolean);
      return parts.some((part) => normalized.includes(part));
    })
    .slice(0, 3);
}

function warnUnresolvedAccountsBeforeMapping(params: {
  rows: Array<{ raw: Record<string, string>; structured: { account?: string | null } | null }>;
  accountColumn?: string;
  accountValueMap: Record<string, string>;
  accounts: Array<{ id: string; name: string }>;
  defaultAccountId?: string;
}): void {
  const { rows, accountColumn, accountValueMap, accounts, defaultAccountId } = params;

  const accountValues = collectAccountValues(rows, accountColumn);
  if (accountValues.length === 0) {
    return;
  }

  const byId = new Set(accounts.map((a) => a.id));
  const byName = new Set(accounts.map((a) => normalizeAccountKey(a.name)));
  const accountNames = accounts.map((a) => a.name);
  const normalizedMap = new Map<string, string>(
    Object.entries(accountValueMap).map(([from, to]) => [normalizeAccountKey(from), to]),
  );

  const unresolved: Array<{ value: string; hints: string[] }> = [];
  for (const value of accountValues) {
    const normalizedValue = normalizeAccountKey(value);
    const explicitTarget = normalizedMap.get(normalizedValue);

    const resolvableByMap =
      explicitTarget !== undefined &&
      (byId.has(explicitTarget) || byName.has(normalizeAccountKey(explicitTarget)));
    const resolvableDirect = byId.has(value) || byName.has(normalizedValue);
    const resolvableByDefault = !value.trim() && Boolean(defaultAccountId);

    if (!resolvableByMap && !resolvableDirect && !resolvableByDefault) {
      unresolved.push({
        value,
        hints: findClosestAccounts(value, accountNames),
      });
    }
  }

  if (unresolved.length === 0) {
    return;
  }

  console.warn(
    `Account mapping preflight warning: ${unresolved.length} account value(s) in this file may fail to resolve.`,
  );
  for (const item of unresolved.slice(0, 10)) {
    const hintText = item.hints.length > 0 ? ` (closest: ${item.hints.join(", ")})` : "";
    console.warn(`  - ${item.value}${hintText}`);
  }
  if (unresolved.length > 10) {
    console.warn(`  - ...and ${unresolved.length - 10} more`);
  }
}

export type CliDependencies = {
  executeImportCommand: typeof executeImportCommand;
  closeActual: typeof closeActual;
  existsSync: typeof existsSync;
  watch: typeof watch;
  formatForUser: typeof formatForUser;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  waitUntilStopped: () => Promise<void>;
};

export async function executeImportCommand(
  file: string,
  options: ValidatedCliOptions,
): Promise<{ accounts: Awaited<ReturnType<typeof listAccounts>> } | null> {
  debug("executeImportCommand: start", { file });

  if (!existsSync(file)) {
    debug("executeImportCommand: file not found, throwing");
    throw new Error(`File not found: "${file}"`);
  }
  debug("executeImportCommand: file exists");

  debug("executeImportCommand: calling initActual with", {
    serverURL: options.serverUrl,
    dataDir: options.dataDir ?? "(default)",
    budgetId: options.budgetId ?? "(none)",
    budgetName: options.budgetName ?? "(none)",
    syncId: options.syncId ?? "(none)",
    hasPassword: Boolean(options.password),
    hasSessionToken: Boolean(options.sessionToken),
  });

  await initActual({
    dataDir: options.dataDir,
    serverURL: options.serverUrl,
    password: options.password,
    sessionToken: options.sessionToken,
    budgetId: options.budgetId,
    budgetName: options.budgetName,
    syncId: options.syncId,
  });
  debug("executeImportCommand: initActual() returned");

  if (!isBudgetLoaded()) {
    debug("executeImportCommand: initActual returned but isBudgetLoaded() is false");
    throw new Error(
      "No budget selected. Pass --budget-id, --budget-name, or --sync-id (or set ACTUAL_BUDGET_ID, ACTUAL_BUDGET_NAME, or ACTUAL_SYNC_ID). " +
        "If you have only one budget it is selected automatically.",
    );
  }
  debug("executeImportCommand: budget is loaded");

  const accounts = await listAccounts();
  debug(
    "executeImportCommand: listAccounts() returned",
    accounts.length,
    "accounts:",
    accounts.map((a) => ({ id: a.id, name: a.name })),
  );

  if (accounts.length === 0) {
    debug("executeImportCommand: no accounts in budget, throwing");
    throw new Error(
      "No accounts found in the budget.\n\nCreate at least one account in Actual Budget before importing transactions.",
    );
  }

  const defaultAccount = resolveAccountByNameOrId(accounts, options.defaultAccount);
  debug("executeImportCommand: defaultAccount resolved", {
    defaultAccount: options.defaultAccount ?? "(none)",
    resolvedId: defaultAccount?.id,
    resolvedName: defaultAccount?.name,
  });

  if (options.defaultAccount && !defaultAccount) {
    debug("executeImportCommand: default account not found, throwing");
    throw new Error(
      `Default account "${options.defaultAccount}" not found.\n\nUse an existing account name or ID. Available accounts: ${accounts.map((a) => a.name).join(", ")}`,
    );
  }

  const fieldMapping = parseFieldMapping(parseKeyValue(options.mapField), options.accountColumn);
  const accountValueMap = parseKeyValue(options.mapAccount);
  const parseOptions = parseFileOptions(options);
  debug("executeImportCommand: built fieldMapping, accountValueMap, parseOptions");

  const { rows, errors, format } = await parseAndNormalizeFile(file, parseOptions);
  debug("executeImportCommand: parseAndNormalizeFile() returned", {
    rows: rows.length,
    errors: errors.length,
    format,
  });

  warnUnresolvedAccountsBeforeMapping({
    rows,
    accountColumn: fieldMapping.account,
    accountValueMap,
    accounts,
    defaultAccountId: defaultAccount?.id,
  });

  const preview = buildPreviewPayload(rows, errors, format);
  const mappingRequest: MappingRequest = {
    fieldMapping,
    defaultAccountId: defaultAccount?.id,
    accountValueMap,
    amountOptions: parseAmountOptions(options),
  };
  debug("executeImportCommand: built preview and mappingRequest");

  const mapped = mapRowsForImport(rows, accounts, mappingRequest);
  debug("executeImportCommand: mapRowsForImport() returned", {
    byAccountIdSize: mapped.byAccountId.size,
    rowErrors: mapped.rowErrors.length,
    totalMapped: Array.from(mapped.byAccountId.values()).reduce((s, r) => s + r.length, 0),
  });

  if (mapped.rowErrors.length > 0 && !options.allowPartial) {
    debug("executeImportCommand: mapping errors and !allowPartial, returning null");
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: "error",
            parseErrors: errors,
            mappingErrors: mapped.rowErrors,
          },
          null,
          2,
        ),
      );
    } else {
      console.error("Row mapping errors:");
      for (const error of mapped.rowErrors.slice(0, 20)) {
        console.error(`  row ${error.rowNumber}: ${error.message}`);
      }
      if (mapped.rowErrors.length > 20) {
        console.error(`  ... and ${mapped.rowErrors.length - 20} more`);
      }
    }
    return null;
  }

  const importResults: Array<{ accountId: string; imported: number; result: unknown }> = [];
  for (const [accountId, txns] of mapped.byAccountId.entries()) {
    if (txns.length === 0) {
      debug("executeImportCommand: skip accountId (no txns)", accountId);
      continue;
    }
    debug("executeImportCommand: importIntoAccount", {
      accountId,
      txnsCount: txns.length,
      dryRun: options.dryRun,
    });
    const result = await importIntoAccount(accountId, txns, options.dryRun);
    importResults.push({
      accountId,
      imported: txns.length,
      result,
    });
    debug("executeImportCommand: importIntoAccount done", { accountId, imported: txns.length });
  }
  debug("executeImportCommand: all imports done, importResults.length =", importResults.length);

  const output = {
    status: "ok",
    format: preview.format,
    parseErrors: preview.errors,
    totalRows: preview.totalRows,
    mappedRows: Array.from(mapped.byAccountId.values()).reduce(
      (acc, rows2) => acc + rows2.length,
      0,
    ),
    mappingErrors: mapped.rowErrors,
    imports: importResults,
    dryRun: options.dryRun,
  };
  debug("executeImportCommand: output built", {
    format: output.format,
    totalRows: output.totalRows,
    mappedRows: output.imports.length,
  });

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Detected format: ${output.format}`);
    console.log(`Rows parsed: ${output.totalRows}`);
    console.log(`Rows mapped: ${output.mappedRows}`);
    if (output.parseErrors.length > 0) {
      console.log(`Parse warnings/errors: ${output.parseErrors.length}`);
    }
    if (output.mappingErrors.length > 0) {
      console.log(`Row mapping errors (skipped): ${output.mappingErrors.length}`);
    }
    for (const item of output.imports) {
      const account = accounts.find((a) => a.id === item.accountId);
      console.log(
        `Imported ${item.imported} transactions into ${account?.name ?? item.accountId} (${item.accountId})`,
      );
    }
  }

  debug("executeImportCommand: done, returning accounts count =", accounts.length);
  return { accounts };
}

export const defaultCliDependencies: CliDependencies = {
  executeImportCommand,
  closeActual,
  existsSync,
  watch,
  formatForUser,
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  waitUntilStopped: () => new Promise<void>(() => {}),
};

export async function executeWatchCommand(
  directory: string,
  options: ValidatedCliOptions,
  deps: CliDependencies,
) {
  if (!deps.existsSync(directory)) {
    throw new Error(
      `Directory not found: "${directory}".\n\nUse an absolute path if the directory is elsewhere.`,
    );
  }

  deps.log(`Watching ${directory} for new import files...`);
  deps.log("Supported extensions:", [...WATCH_EXTENSIONS].join(", "));
  deps.log("Press Ctrl+C to stop.\n");

  const processing = new Set<string>();

  deps.watch(directory, { recursive: false }, async (eventType, filename) => {
    if (!filename || eventType !== "rename") return;

    const ext = extname(filename).toLowerCase();
    if (!WATCH_EXTENSIONS.has(ext)) return;

    const filePath = join(directory, filename);
    if (processing.has(filePath)) return;

    try {
      if (!deps.existsSync(filePath)) return;
    } catch {
      return;
    }

    processing.add(filePath);
    deps.log(`\n[${new Date().toISOString()}] Importing: ${filename}`);

    try {
      await deps.executeImportCommand(filePath, options);
    } catch (err) {
      deps.error(`Import failed for ${filename}:`, deps.formatForUser(err));
    } finally {
      processing.delete(filePath);
    }
  });

  await deps.waitUntilStopped();
}
