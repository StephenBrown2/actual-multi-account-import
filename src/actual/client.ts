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
let budgetLoaded = false;
let currentBudgetId: string | null = null;

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
    return null;
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
  currentBudgetId = selected.id;
  budgetLoaded = true;
  return selected;
}

export function getCurrentBudgetId(): string | null {
  return currentBudgetId;
}

export function isBudgetLoaded(): boolean {
  return initialized && budgetLoaded;
}

export function isConnected(): boolean {
  return initialized;
}

type BudgetListItem = {
  id: string | null;
  name: string;
  groupId?: string;
  cloudFileId?: string;
  /** Sync id to use for download (groupId or cloudFileId). */
  syncId?: string;
};

export async function listBudgets(): Promise<BudgetListItem[]> {
  if (!initialized) {
    throw new Error("Not connected to Actual. Connect first.");
  }
  const budgets = await getBudgets();
  return budgets.map((b) => {
    const row = b as { id?: string; name: string; groupId?: string; cloudFileId?: string };
    const syncId = row.groupId ?? row.cloudFileId;
    return {
      id: row.id ?? null,
      name: row.name,
      groupId: row.groupId,
      cloudFileId: row.cloudFileId,
      syncId: syncId ?? undefined,
    };
  });
}

/**
 * Verify the connection by listing budgets (works without a budget loaded).
 * getServerVersion() requires a budget to be open, so we use getBudgets() instead.
 */
export async function verifyConnection(): Promise<void> {
  if (!initialized) {
    throw new Error("Not connected to Actual. Connect first.");
  }
  await getBudgets();
}

export async function selectBudget(budgetId: string): Promise<void> {
  if (!initialized) {
    throw new Error("Not connected to Actual. Connect first.");
  }
  await loadBudget(budgetId);
  budgetLoaded = true;
}

/**
 * Select a budget by local id or by sync id (downloads from cloud if needed).
 * When syncId is provided, password is used for downloadBudget.
 */
export async function selectBudgetByIdOrSyncId(
  opts: { budgetId?: string; syncId?: string; password?: string },
): Promise<void> {
  if (!initialized) {
    throw new Error("Not connected to Actual. Connect first.");
  }
  const { budgetId, syncId, password } = opts;
  if (budgetId) {
    await loadBudget(budgetId);
    currentBudgetId = budgetId;
    budgetLoaded = true;
    return;
  }
  if (!syncId) {
    throw new Error("Provide either budgetId or syncId.");
  }
  await downloadBudget(syncId, password ? { password } : undefined);
  const budgets = await getBudgets();
  const budget = budgets.find(
    (b) => (b as { id?: string; groupId?: string; cloudFileId?: string }).groupId === syncId
      || (b as { cloudFileId?: string }).cloudFileId === syncId,
  );
  const id = budget && (budget as { id?: string }).id;
  if (!id) {
    throw new Error("Budget was downloaded but could not be loaded. Try selecting it again.");
  }
  await loadBudget(id);
  currentBudgetId = id;
  budgetLoaded = true;
}

export async function initActual(opts: ConnectionOptions): Promise<void> {
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
  currentBudgetId = null;
  budgetLoaded = false;
  const selected = await pickAndLoadBudget(opts);
  if (selected) {
    currentBudgetId = (selected as { id?: string }).id ?? null;
    budgetLoaded = true;
  }
  initialized = true;
}

export async function closeActual(): Promise<void> {
  if (!initialized) {
    return;
  }
  await shutdown();
  initialized = false;
  budgetLoaded = false;
  currentBudgetId = null;
}

export async function listAccounts(): Promise<AccountRef[]> {
  if (!budgetLoaded) {
    throw new Error("No budget loaded. Select a budget first.");
  }
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
  if (!budgetLoaded) {
    throw new Error("No budget loaded. Select a budget first.");
  }
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
): Promise<unknown> {
  if (!budgetLoaded) {
    throw new Error("No budget loaded. Select a budget first.");
  }
  const payload = transactions.map((txn) => ({ ...txn, account: accountId }));
  return importTransactions(accountId, payload, { dryRun });
}
