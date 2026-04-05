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

const DEBUG = process.env.ACTUAL_IMPORT_DEBUG === "1" || process.env.ACTUAL_IMPORT_DEBUG === "true";
function debug(...args: unknown[]) {
  if (DEBUG) {
    const prefix = `[actual-client] ${new Date().toISOString()}`;
    console.error(prefix, ...args);
  }
}

type BudgetRecord = {
  id?: string | null;
  name: string;
  groupId?: string;
  cloudFileId?: string;
};

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

function budgetMatchesSyncId(budget: BudgetRecord, syncId: string): boolean {
  return budget.groupId === syncId || budget.cloudFileId === syncId;
}

function findBudgetBySelector(
  budgets: BudgetRecord[],
  opts: Pick<ConnectionOptions, "budgetId" | "budgetName" | "syncId">,
): BudgetRecord | null {
  if (opts.budgetId) {
    return budgets.find((budget) => budget.id === opts.budgetId) ?? null;
  }

  if (opts.budgetName) {
    const matches = budgets.filter((budget) => budget.name === opts.budgetName);
    if (matches.length === 0) {
      return null;
    }
    return matches.find((budget) => Boolean(budget.id)) ?? matches[0] ?? null;
  }

  if (opts.syncId) {
    const matches = budgets.filter((budget) => budgetMatchesSyncId(budget, opts.syncId!));
    if (matches.length === 0) {
      return null;
    }
    return matches.find((budget) => Boolean(budget.id)) ?? matches[0] ?? null;
  }

  if (budgets.length === 1) {
    return budgets[0] ?? null;
  }

  return null;
}

function hasBudgetSelection(opts: Pick<ConnectionOptions, "budgetId" | "budgetName" | "syncId">) {
  return Boolean(opts.budgetId || opts.budgetName || opts.syncId);
}

export const budgetSelectionTestUtils = {
  budgetMatchesSyncId,
  findBudgetBySelector,
  hasBudgetSelection,
};

async function pickAndLoadBudget(opts: ConnectionOptions) {
  debug("pickAndLoadBudget: opts", {
    serverURL: opts.serverURL,
    dataDir: opts.dataDir,
    budgetId: opts.budgetId ?? "(none)",
    budgetName: opts.budgetName ?? "(none)",
    syncId: opts.syncId ?? "(none)",
    hasPassword: Boolean(opts.password),
    hasSessionToken: Boolean(opts.sessionToken),
  });

  let budgets = await getBudgets();
  debug(
    "getBudgets() returned",
    budgets.length,
    "budget(s):",
    budgets.map((b) => {
      const r = b as { id?: string; name?: string; groupId?: string; cloudFileId?: string };
      return { id: r.id ?? null, name: r.name, groupId: r.groupId, cloudFileId: r.cloudFileId };
    }),
  );

  if (opts.syncId) {
    const exists = budgets.some((budget) =>
      budgetMatchesSyncId(budget as BudgetRecord, opts.syncId!),
    );
    debug("syncId provided; already downloaded?", exists);
    if (!exists) {
      debug("downloading budget for syncId", opts.syncId);
      await downloadBudget(opts.syncId, opts.password ? { password: opts.password } : undefined);
      budgets = await getBudgets();
      debug("getBudgets() after download:", budgets.length, "budget(s)");
    }
  }

  let selected = findBudgetBySelector(budgets as BudgetRecord[], opts);
  debug(
    "selection by selectors =>",
    selected ? { id: selected.id ?? null, name: selected.name } : null,
  );

  if (!selected) {
    debug("pickAndLoadBudget: no budget selected, returning null");
    return null;
  }

  if (!selected.id) {
    const syncId =
      (selected as { groupId?: string; cloudFileId?: string }).groupId ??
      (selected as { cloudFileId?: string }).cloudFileId ??
      opts.syncId;
    debug("selected budget has no local id; syncId for download:", syncId);
    if (syncId) {
      await downloadBudget(syncId, opts.password ? { password: opts.password } : undefined);
      budgets = await getBudgets();
      selected = findBudgetBySelector(budgets as BudgetRecord[], {
        budgetId: opts.budgetId,
        budgetName: opts.budgetName,
        syncId,
      });
      debug(
        "after download, selected =>",
        selected ? { id: selected.id ?? null, name: selected.name } : null,
      );
    }
  }

  if (!selected?.id) {
    debug("pickAndLoadBudget: selected budget has no id after download");
    throw new Error(
      [
        `Selected budget "${selected?.name ?? "(unknown)"}" is not downloaded locally yet.`,
        "Set ACTUAL_SYNC_ID (or --sync-id) so this app can download it, then retry.",
      ].join(" "),
    );
  }

  debug("calling loadBudget(", selected.id, ")");
  await loadBudget(selected.id);
  currentBudgetId = selected.id;
  budgetLoaded = true;
  debug(
    "pickAndLoadBudget: done. currentBudgetId=",
    currentBudgetId,
    "budgetLoaded=",
    budgetLoaded,
  );
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
export async function selectBudgetByIdOrSyncId(opts: {
  budgetId?: string;
  syncId?: string;
  password?: string;
}): Promise<void> {
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
    (b) =>
      (b as { id?: string; groupId?: string; cloudFileId?: string }).groupId === syncId ||
      (b as { cloudFileId?: string }).cloudFileId === syncId,
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
  debug("initActual called; initialized=", initialized);
  if (initialized) {
    debug("initActual: already initialized");
    if (!budgetLoaded && hasBudgetSelection(opts)) {
      debug("initActual: budget not loaded yet; retrying pickAndLoadBudget");
      const selected = await pickAndLoadBudget(opts);
      if (selected?.id) {
        currentBudgetId = selected.id;
        budgetLoaded = true;
      }
    }
    return;
  }

  assertConnection(opts);
  debug("initActual: assertConnection ok, ensuring dataDir", opts.dataDir);
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

  debug("initActual: calling init( { dataDir, serverURL, auth } )");
  await init(initConfig);
  currentBudgetId = null;
  budgetLoaded = false;
  initialized = true;
  debug("initActual: init() done, calling pickAndLoadBudget");
  const selected = await pickAndLoadBudget(opts);
  if (selected) {
    currentBudgetId = (selected as { id?: string }).id ?? null;
    budgetLoaded = true;
    debug("initActual: budget loaded. currentBudgetId=", currentBudgetId);
  } else {
    debug("initActual: pickAndLoadBudget returned null; no budget loaded");
  }
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
  debug(
    "listAccounts: initialized=",
    initialized,
    "budgetLoaded=",
    budgetLoaded,
    "currentBudgetId=",
    currentBudgetId,
  );
  if (!budgetLoaded) {
    debug("listAccounts: throwing (no budget loaded)");
    throw new Error("No budget loaded. Select a budget first.");
  }
  const accounts = await getAccounts();
  debug("listAccounts: getAccounts() returned", accounts?.length ?? 0, "accounts");
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
  debug("parseFileWithActual: start", {
    filepath,
    hasHeaderRow: options.hasHeaderRow,
    delimiter: options.delimiter ?? "(auto)",
    skipStartLines: options.skipStartLines ?? 0,
    skipEndLines: options.skipEndLines ?? 0,
    importNotes: options.importNotes,
    fallbackMissingPayeeToMemo: options.fallbackMissingPayeeToMemo,
    currentBudgetId,
  });
  if (!budgetLoaded) {
    throw new Error("No budget loaded. Select a budget first.");
  }

  const actualInternal = internal as {
    send?: (channel: string, payload: unknown) => Promise<unknown>;
  } | null;
  debug("parseFileWithActual: internal.send available?", Boolean(actualInternal?.send));
  if (!actualInternal?.send) {
    throw new Error(
      "Actual parser is unavailable after budget load. internal.send is missing; check the preceding ACTUAL_IMPORT_DEBUG logs for init/loadBudget state.",
    );
  }

  try {
    const result = (await actualInternal.send("transactions-parse-file", {
      filepath,
      options,
    })) as ParsedFileResult;
    debug("parseFileWithActual: parser returned", {
      transactions: result.transactions?.length ?? 0,
      errors: result.errors?.length ?? 0,
    });
    return result;
  } catch (error) {
    debug(
      "parseFileWithActual: parser threw",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    throw error;
  }
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
