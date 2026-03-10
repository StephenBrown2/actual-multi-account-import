#!/usr/bin/env node
import { existsSync, watch } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import dotenv from "dotenv";
dotenv.config();

import { closeActual, importIntoAccount, initActual, listAccounts } from "./actual/client";
import { formatForUser } from "./errors";
import { resolveAccountByNameOrId } from "./import/accounts";
import { mapRowsForImport } from "./import/mapping";
import { buildPreviewPayload, parseAndNormalizeFile } from "./import/parse";
import type { AmountOptions, FieldMapping, MappingRequest, ParseFileOptions } from "./types";

const WATCH_EXTENSIONS = new Set([".csv", ".tsv", ".qif", ".ofx", ".qfx", ".xml"]);

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
};

type CliDependencies = {
  runImport: typeof runImport;
  closeActual: typeof closeActual;
  existsSync: typeof existsSync;
  watch: typeof watch;
  formatForUser: typeof formatForUser;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  waitUntilStopped: () => Promise<void>;
};

const defaultCliDependencies: CliDependencies = {
  runImport,
  closeActual,
  existsSync,
  watch,
  formatForUser,
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  waitUntilStopped: () => new Promise<void>(() => {}),
};

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
  const result: FieldMapping = {
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
  return result;
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

async function runImport(
  file: string,
  options: CliOptions & { serverUrl: string },
): Promise<{ accounts: Awaited<ReturnType<typeof listAccounts>> } | null> {
  if (!existsSync(file)) {
    throw new Error(`File not found: "${file}"`);
  }

  if (!options.password && !options.sessionToken) {
    throw new Error(
      "Authentication required. Provide either --password <password> or --session-token <token> to connect to the Actual server.",
    );
  }

  await initActual({
    dataDir: options.dataDir,
    serverURL: options.serverUrl,
    password: options.password,
    sessionToken: options.sessionToken,
    budgetId: options.budgetId,
    budgetName: options.budgetName,
    syncId: options.syncId,
  });

  const accounts = await listAccounts();
  if (accounts.length === 0) {
    throw new Error(
      "No accounts found in the budget.\n\nCreate at least one account in Actual Budget before importing transactions.",
    );
  }

  const defaultAccount = resolveAccountByNameOrId(accounts, options.defaultAccount);
  if (options.defaultAccount && !defaultAccount) {
    throw new Error(
      `Default account "${options.defaultAccount}" not found.\n\nUse an existing account name or ID. Available accounts: ${accounts.map((a) => a.name).join(", ")}`,
    );
  }

  const fieldMapping = parseFieldMapping(parseKeyValue(options.mapField), options.accountColumn);
  const accountValueMap = parseKeyValue(options.mapAccount);
  const parseOptions = parseFileOptions(options);

  const { rows, errors, format } = await parseAndNormalizeFile(file, parseOptions);
  const preview = buildPreviewPayload(rows, errors, format);
  const mappingRequest: MappingRequest = {
    fieldMapping,
    defaultAccountId: defaultAccount?.id,
    accountValueMap,
    amountOptions: parseAmountOptions(options),
  };

  const mapped = mapRowsForImport(rows, accounts, mappingRequest);
  if (mapped.rowErrors.length > 0 && !options.allowPartial) {
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
      continue;
    }
    const result = await importIntoAccount(accountId, txns, options.dryRun);
    importResults.push({
      accountId,
      imported: txns.length,
      result,
    });
  }

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

  return { accounts };
}

export function buildProgram(deps: CliDependencies = defaultCliDependencies): Command {
  const program = new Command();

  program
    .name("actual-multi-account-import")
    .description("Import one file into Actual with optional per-row account mapping")
    .argument("<file>", "Path to import file (csv/tsv/qif/ofx/qfx/xml)")
    .option("--server-url <url>", "Actual server URL")
    .option("--password <password>", "Actual server password")
    .option("--session-token <token>", "Actual API session token")
    .option("--data-dir <path>", "Directory to store local Actual state")
    .option("--budget-id <id>", "Budget ID to load")
    .option("--budget-name <name>", "Budget name to load")
    .option("--sync-id <id>", "Sync ID (downloads budget if needed)")
    .option("--default-account <name-or-id>", "Fallback account when account column is absent")
    .option("--account-column <column>", "Column containing account names/ids")
    .option(
      "--map-account <from=to>",
      "Map account column value to Actual account id/name",
      collect,
      [],
    )
    .option(
      "--map-field <field=column>",
      "Map fields for delimited files (date,amount,inflow,outflow,inOut,payee,notes,importedId,account,cleared)",
      collect,
      [],
    )
    .option("--has-header", "Delimited file has a header row", true)
    .option("--no-has-header", "Delimited file has no header row")
    .option("--delimiter <char>", "CSV/TSV delimiter override")
    .option("--skip-start-lines <n>", "Skip first N lines")
    .option("--skip-end-lines <n>", "Skip last N lines")
    .option("--import-notes", "Import note/memo values where supported", true)
    .option("--no-import-notes", "Do not import note/memo values")
    .option("--fallback-missing-payee-to-memo", "OFX/QFX: use memo when payee is missing", false)
    .option("--dry-run", "Preview import only; do not write transactions", false)
    .option("--allow-partial", "Import valid rows even if some rows fail validation", false)
    .option("--json", "Emit machine-readable JSON output", false)
    .option("--in-out-mode", "Use in/out column to determine inflow vs outflow")
    .option("--out-value <string>", "Value in in/out column that means outflow (e.g. debit)")
    .option("--split-mode", "Use separate inflow and outflow columns")
    .option("--flip-amount", "Negate amounts (inflow↔outflow)")
    .option("--multiplier-amount <n>", "Multiply amounts by this factor", "1")
    .action(async (file: string, rawOptions: CliOptions) => {
      const options = withEnvFallback(rawOptions);
      assertRequiredOptions(options);
      await deps.runImport(file, options);
    });

  program
    .command("watch <directory>")
    .description("Watch a directory and auto-import CSV/TSV/QIF/OFX/QFX/XML files when they appear")
    .option("--server-url <url>", "Actual server URL")
    .option("--password <password>", "Actual server password")
    .option("--session-token <token>", "Actual API session token")
    .option("--data-dir <path>", "Directory to store local Actual state")
    .option("--budget-id <id>", "Budget ID to load")
    .option("--budget-name <name>", "Budget name to load")
    .option("--sync-id <id>", "Sync ID (download budget if needed)")
    .option("--default-account <name-or-id>", "Fallback account when account column is absent")
    .option("--account-column <column>", "Column containing account names/ids")
    .option(
      "--map-account <from=to>",
      "Map account column value to Actual account id/name",
      collect,
      [],
    )
    .option(
      "--map-field <field=column>",
      "Map fields for delimited files (date,amount,inflow,outflow,inOut,payee,notes,importedId,account,cleared)",
      collect,
      [],
    )
    .option("--has-header", "Delimited file has a header row", true)
    .option("--no-has-header", "Delimited file has no header row")
    .option("--delimiter <char>", "CSV/TSV delimiter override")
    .option("--skip-start-lines <n>", "Skip first N lines")
    .option("--skip-end-lines <n>", "Skip last N lines")
    .option("--import-notes", "Import note/memo values where supported", true)
    .option("--no-import-notes", "Do not import note/memo values")
    .option("--fallback-missing-payee-to-memo", "OFX/QFX: use memo when payee is missing", false)
    .option("--dry-run", "Preview import only; do not write transactions", false)
    .option("--allow-partial", "Import valid rows even if some rows fail validation", false)
    .option("--json", "Emit machine-readable JSON output", false)
    .option("--in-out-mode", "Use in/out column to determine inflow vs outflow")
    .option("--out-value <string>", "Value in in/out column that means outflow (e.g. debit)")
    .option("--split-mode", "Use separate inflow and outflow columns")
    .option("--flip-amount", "Negate amounts (inflow↔outflow)")
    .option("--multiplier-amount <n>", "Multiply amounts by this factor", "1")
    .action(async (directory: string, rawOptions: CliOptions, command: Command) => {
      const scopedOptions =
        typeof command.optsWithGlobals === "function" ? command.optsWithGlobals() : rawOptions;
      const options = withEnvFallback(scopedOptions as CliOptions);
      assertRequiredOptions(options);

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
          await deps.runImport(filePath, options);
        } catch (err) {
          deps.error(`Import failed for ${filename}:`, deps.formatForUser(err));
        } finally {
          processing.delete(filePath);
        }
      });

      await deps.waitUntilStopped();
    });

  return program;
}

export function collect(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

export async function main(
  argv: string[] = process.argv,
  deps: CliDependencies = defaultCliDependencies,
) {
  const program = buildProgram(deps);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    deps.error(deps.formatForUser(error));
    process.exitCode = 1;
  } finally {
    await deps.closeActual();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
