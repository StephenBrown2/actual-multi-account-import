import { existsSync, watch } from "node:fs";
import { extname, join } from "node:path";

import { closeActual, importIntoAccount, initActual, listAccounts } from "../actual/client";
import { formatForUser } from "../errors";
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
  if (!existsSync(file)) {
    throw new Error(`File not found: "${file}"`);
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
