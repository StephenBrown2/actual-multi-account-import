#!/usr/bin/env node
import { existsSync } from "node:fs";
import { Command } from "commander";
import dotenv from "dotenv";
dotenv.config();

import { closeActual, importIntoAccount, initActual, listAccounts } from "./actual/client";
import { formatForUser } from "./errors";
import { resolveAccountByNameOrId } from "./import/accounts";
import { mapRowsForImport } from "./import/mapping";
import { buildPreviewPayload, parseAndNormalizeFile } from "./import/parse";
import type { FieldMapping, MappingRequest, ParseFileOptions } from "./types";

type CliOptions = {
  serverUrl: string;
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
};

function parseKeyValue(items: string[] | undefined): Record<string, string> {
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

function parseFieldMapping(raw: Record<string, string>, accountColumn?: string): FieldMapping {
  const result: FieldMapping = {
    date: raw.date,
    amount: raw.amount,
    inflow: raw.inflow,
    outflow: raw.outflow,
    payeeName: raw.payee ?? raw.payeeName,
    importedPayee: raw.importedPayee,
    notes: raw.notes,
    importedId: raw.importedId ?? raw.imported_id,
    account: raw.account ?? accountColumn,
    cleared: raw.cleared,
  };
  return result;
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

function parseFileOptions(options: CliOptions): ParseFileOptions {
  return {
    hasHeaderRow: options.hasHeader,
    delimiter: options.delimiter,
    fallbackMissingPayeeToMemo: options.fallbackMissingPayeeToMemo,
    skipStartLines: intOption(options.skipStartLines),
    skipEndLines: intOption(options.skipEndLines),
    importNotes: options.importNotes,
  };
}

const program = new Command();
program
  .name("actual-multi-account-import")
  .description("Import one file into Actual with optional per-row account mapping")
  .argument("<file>", "Path to import file (csv/tsv/qif/ofx/qfx/xml)")
  .requiredOption("--server-url <url>", "Actual server URL")
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
    "Map fields for delimited files (date,amount,inflow,outflow,payee,notes,importedId,account,cleared)",
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
  .action(async (file: string, options: CliOptions) => {
    if (!existsSync(file)) {
      throw new Error(
        `File not found: "${file}".\n\nCheck that the path is correct and the file exists. Use an absolute path if the file is in another directory.`,
      );
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
      process.exitCode = 1;
      return;
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
      return;
    }

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
  });

function collect(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(formatForUser(error));
    process.exitCode = 1;
  } finally {
    await closeActual();
  }
}

void main();
