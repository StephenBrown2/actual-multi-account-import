import { mkdir } from "node:fs/promises";
import {
  downloadBudget,
  getAccounts,
  getBudgets,
  importTransactions,
  init,
  internal,
  loadBudget,
  shutdown,
} from "@actual-app/api";

import type {
  AccountRef,
  ConnectionOptions,
  ParseFileOptions,
  ParsedFileResult,
  PreparedImportTransaction,
} from "../types";

let initialized = false;

async function ensureDataDirExists(dataDir?: string) {
  if (!dataDir) {
    return;
  }
  await mkdir(dataDir, { recursive: true });
}

function assertConnection(opts: ConnectionOptions) {
  if (!opts.serverURL) {
    throw new Error("Missing Actual server URL");
  }
  if (!opts.password && !opts.sessionToken) {
    throw new Error("Provide either password or session token");
  }
}

async function pickAndLoadBudget(opts: ConnectionOptions) {
  let budgets = await getBudgets();

  if (opts.syncId) {
    const exists = budgets.some((b) => (b as { groupId?: string }).groupId === opts.syncId);
    if (!exists) {
      await downloadBudget(opts.syncId, opts.password ? { password: opts.password } : undefined);
      budgets = await getBudgets();
    }
  }

  const byName = (name: string) => {
    const matches = budgets.filter((b) => b.name === name);
    if (matches.length === 0) {
      return null;
    }
    // Prefer a budget that is already downloaded locally.
    return matches.find((b) => Boolean(b.id)) ?? matches[0] ?? null;
  };

  let selected = null as (typeof budgets)[number] | null;
  if (opts.budgetId) {
    selected = budgets.find((b) => b.id === opts.budgetId) ?? null;
  } else if (opts.budgetName) {
    selected = byName(opts.budgetName);
  } else if (budgets.length === 1) {
    selected = budgets[0] ?? null;
  }

  if (!selected) {
    const printable = budgets.map((b) => `${b.id ?? "no-id"} :: ${b.name}`).join("\n");
    throw new Error(
      [
        "Unable to resolve budget.",
        "Provide --budget-id or --budget-name, or ensure only one local budget is available.",
        `Available budgets:\n${printable || "(none found)"}`,
      ].join("\n"),
    );
  }

  if (!selected.id) {
    const syncId = (selected as { groupId?: string }).groupId ?? opts.syncId;
    if (syncId) {
      await downloadBudget(syncId, opts.password ? { password: opts.password } : undefined);
      budgets = await getBudgets();
      selected = opts.budgetId
        ? (budgets.find((b) => b.id === opts.budgetId) ?? null)
        : opts.budgetName
          ? byName(opts.budgetName)
          : (budgets.find((b) => (b as { groupId?: string }).groupId === syncId) ?? null);
    }
  }

  if (!selected?.id) {
    throw new Error(
      [
        `Selected budget "${selected?.name ?? "(unknown)"}" is not downloaded locally yet.`,
        "Set ACTUAL_SYNC_ID (or --sync-id) so this app can download it, then retry.",
      ].join(" "),
    );
  }

  await loadBudget(selected.id);
  return selected;
}

export async function initActual(opts: ConnectionOptions) {
  if (initialized) {
    return;
  }

  assertConnection(opts);
  await ensureDataDirExists(opts.dataDir);
  const initConfig = opts.sessionToken
    ? {
        dataDir: opts.dataDir,
        serverURL: opts.serverURL,
        sessionToken: opts.sessionToken,
      }
    : {
        dataDir: opts.dataDir,
        serverURL: opts.serverURL,
        password: opts.password!,
      };

  await init(initConfig);
  await pickAndLoadBudget(opts);
  initialized = true;
}

export async function closeActual() {
  if (!initialized) {
    return;
  }
  await shutdown();
  initialized = false;
}

export async function listAccounts(): Promise<AccountRef[]> {
  const accounts = await getAccounts();
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    closed: account.closed,
    offbudget: account.offbudget,
  }));
}

export async function parseFileWithActual(
  filepath: string,
  options: ParseFileOptions,
): Promise<ParsedFileResult> {
  const result = (await internal.send("transactions-parse-file", {
    filepath,
    options,
  })) as ParsedFileResult;
  return result;
}

export async function importIntoAccount(
  accountId: string,
  transactions: PreparedImportTransaction[],
  dryRun: boolean,
) {
  const payload = transactions.map((txn) => ({ ...txn, account: accountId }));
  return importTransactions(accountId, payload, { dryRun });
}
