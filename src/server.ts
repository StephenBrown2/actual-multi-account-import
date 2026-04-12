#!/usr/bin/env node
import { rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import multer from "multer";

import {
  closeActual,
  getCurrentBudgetId,
  importIntoAccount,
  initActual,
  isBudgetLoaded,
  isConnected,
  listAccounts,
  listBudgets,
  selectBudgetByIdOrSyncId,
  verifyConnection,
} from "./actual/client";
import { toUserFacingError } from "./errors";

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  return (req, res, next) => {
    void fn(req, res).catch(next);
  };
}
import { mapRowsForImport } from "./import/mapping";
import { applyDateFilter } from "./import/dateFilter";
import { buildPreviewPayload, parseAndNormalizeFile } from "./import/parse";
import type { FieldMapping, MappingRequest, NormalizedRow, ParseFileOptions } from "./types";

dotenv.config();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  if (reason instanceof Error) {
    console.error(reason.stack);
  }
});

type PreviewSession = {
  id: string;
  rows: NormalizedRow[];
  createdAt: number;
};

type ImportBody = {
  sessionId: string;
  mapping: FieldMapping;
  accountValueMap?: Record<string, string>;
  defaultAccountId?: string;
  beforeDate?: string;
  afterDate?: string;
  amountOptions?: {
    splitMode?: boolean;
    inOutMode?: boolean;
    outValue?: string;
    flipAmount?: boolean;
    multiplierAmount?: string;
  };
  dryRun?: boolean;
  allowPartial?: boolean;
};

const sessions = new Map<string, PreviewSession>();
/** Password from last POST /api/connect, used when selecting a cloud budget. Not persisted. */
let lastConnectPassword: string | undefined;
const webRoot = join(import.meta.dirname, "..", "web", "dist");
const upload = multer({ dest: "/tmp" });

function sendError(res: Response, status: number, message: string, hint?: string): void {
  const payload: { error: string; hint?: string } = { error: message };
  if (hint) payload.hint = hint;
  res.status(status).json(payload);
}

function boolFromForm(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intFromForm(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseImportOptionsFromBody(body: Record<string, unknown>): ParseFileOptions {
  return {
    hasHeaderRow: boolFromForm(body.hasHeaderRow, true),
    delimiter: typeof body.delimiter === "string" ? body.delimiter : undefined,
    fallbackMissingPayeeToMemo: boolFromForm(body.fallbackMissingPayeeToMemo, false),
    skipStartLines: intFromForm(body.skipStartLines),
    skipEndLines: intFromForm(body.skipEndLines),
    importNotes: boolFromForm(body.importNotes, true),
  };
}

async function tryInitializeFromEnv(): Promise<void> {
  const serverURL = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;
  const sessionToken = process.env.ACTUAL_SESSION_TOKEN;
  if (!serverURL || (!password && !sessionToken)) {
    return;
  }
  await initActual({
    serverURL,
    password,
    sessionToken,
    dataDir: process.env.ACTUAL_DATA_DIR,
    budgetId: process.env.ACTUAL_BUDGET_ID,
    budgetName: process.env.ACTUAL_BUDGET_NAME,
    syncId: process.env.ACTUAL_SYNC_ID,
  });
}

function cleanupExpiredSessions(ttlMs = 30 * 60 * 1000): void {
  const cutoff = Date.now() - ttlMs;
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) {
      sessions.delete(id);
    }
  }
}

async function bootstrap(): Promise<void> {
  if (!existsSync(join(webRoot, "index.html"))) {
    console.error(
      "Web UI not built. Run 'npm run web:build' or 'npm run server' (which builds automatically) before starting. Expected files at:",
      webRoot,
    );
    process.exit(1);
  }
  try {
    await tryInitializeFromEnv();
  } catch (err) {
    const { message, hint } = toUserFacingError(err);
    console.warn("Could not initialize from environment:", message);
    if (hint) console.warn(hint);
  }
}

await bootstrap();

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(webRoot));

app.get("/", (_req, res) => {
  res.sendFile(join(webRoot, "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get(
  "/api/status",
  asyncHandler(async (_req, res) => {
    const connected = isConnected();
    const budgetLoaded = isBudgetLoaded();
    const currentBudgetId = getCurrentBudgetId();
    let budgets: Array<{ id: string | null; name: string; groupId?: string; syncId?: string }> = [];
    if (connected) {
      try {
        budgets = await listBudgets();
      } catch {
        budgets = [];
      }
    }
    res.json({
      connected,
      budgetLoaded,
      currentBudgetId: budgetLoaded ? currentBudgetId : undefined,
      budgets: connected ? budgets : undefined,
    });
  }),
);

app.post(
  "/api/connect",
  asyncHandler(async (req, res) => {
    if (isConnected()) {
      sendError(
        res,
        400,
        "Already connected.",
        "Server is already connected to an Actual instance.",
      );
      return;
    }
    const body = req.body as {
      serverURL?: string;
      password?: string;
      sessionToken?: string;
      dataDir?: string;
    };
    const serverURL = typeof body.serverURL === "string" ? body.serverURL.trim() : "";
    const password = typeof body.password === "string" ? body.password : undefined;
    const sessionToken =
      typeof body.sessionToken === "string" ? body.sessionToken.trim() : undefined;
    if (!serverURL || (!password && !sessionToken)) {
      sendError(
        res,
        400,
        "Missing server URL or credentials.",
        "Provide serverURL and either password or sessionToken.",
      );
      return;
    }
    try {
      await initActual({
        serverURL,
        password,
        sessionToken,
        dataDir: body.dataDir,
      });
      await verifyConnection();
      lastConnectPassword = password;
      const budgets = await listBudgets();
      res.json({ connected: true, budgets });
    } catch (err) {
      const { message, hint } = toUserFacingError(err);
      sendError(res, 400, message, hint);
    }
  }),
);

app.get(
  "/api/budgets",
  asyncHandler(async (_req, res) => {
    if (!isConnected()) {
      sendError(
        res,
        503,
        "Not connected.",
        "Connect to an Actual server first (use the setup form).",
      );
      return;
    }
    const budgets = await listBudgets();
    res.json({ budgets });
  }),
);

app.post(
  "/api/select-budget",
  asyncHandler(async (req, res) => {
    if (!isConnected()) {
      sendError(res, 503, "Not connected.", "Connect to an Actual server first.");
      return;
    }
    const body = req.body as { budgetId?: string; syncId?: string; password?: string };
    const budgetId = typeof body.budgetId === "string" ? body.budgetId.trim() : undefined;
    const syncId = typeof body.syncId === "string" ? body.syncId.trim() : undefined;
    const password =
      typeof body.password === "string"
        ? body.password
        : (lastConnectPassword ?? process.env.ACTUAL_PASSWORD);
    if (!budgetId && !syncId) {
      sendError(
        res,
        400,
        "Missing budgetId or syncId.",
        "Select a budget from the list (local or cloud).",
      );
      return;
    }
    try {
      await selectBudgetByIdOrSyncId({
        budgetId: budgetId || undefined,
        syncId: syncId || undefined,
        password,
      });
    } catch (err) {
      const { message, hint } = toUserFacingError(err);
      sendError(res, 400, message, hint);
      return;
    }
    res.json({ ok: true, budgetLoaded: true });
  }),
);

app.get(
  "/api/accounts",
  asyncHandler(async (_req, res) => {
    if (!isBudgetLoaded()) {
      const connected = isConnected();
      sendError(
        res,
        503,
        connected ? "No budget selected." : "Not connected.",
        connected
          ? "Select a budget from the setup section above."
          : "Connect to an Actual server and select a budget.",
      );
      return;
    }
    const accounts = await listAccounts();
    res.json({
      accounts,
      supportedFormats: [".csv", ".tsv", ".qif", ".ofx", ".qfx", ".xml"],
    });
  }),
);

app.post(
  "/api/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!isBudgetLoaded()) {
      const connected = isConnected();
      sendError(
        res,
        503,
        connected ? "No budget selected." : "Not connected.",
        connected
          ? "Select a budget from the setup section above."
          : "Connect to an Actual server and select a budget.",
      );
      return;
    }
    cleanupExpiredSessions();
    if (!req.file) {
      sendError(
        res,
        400,
        "No file was uploaded.",
        "Select a transaction file (CSV, TSV, QIF, OFX, QFX, or XML) and try again.",
      );
      return;
    }

    let parsePath = req.file.path;
    const originalExt = extname(req.file.originalname || "");
    if (originalExt && !parsePath.endsWith(originalExt)) {
      try {
        const renamedPath = `${parsePath}${originalExt}`;
        await rename(parsePath, renamedPath);
        parsePath = renamedPath;
      } catch (err) {
        await unlink(parsePath).catch(() => undefined);
        const { message, hint } = toUserFacingError(err);
        sendError(res, 500, message, hint);
        return;
      }
    }

    try {
      const options = parseImportOptionsFromBody(req.body as Record<string, unknown>);
      const { rows, errors, format } = await parseAndNormalizeFile(parsePath, options);
      const preview = buildPreviewPayload(rows, errors, format);
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, {
        id: sessionId,
        rows,
        createdAt: Date.now(),
      });

      res.json({
        sessionId,
        filename: req.file.originalname,
        ...preview,
      });
    } catch (err) {
      const { message, hint } = toUserFacingError(err);
      sendError(res, 400, message, hint);
    } finally {
      await unlink(parsePath).catch(() => undefined);
    }
  }),
);

app.post(
  "/api/import",
  asyncHandler(async (req, res) => {
    if (!isBudgetLoaded()) {
      const connected = isConnected();
      sendError(
        res,
        503,
        connected ? "No budget selected." : "Not connected.",
        connected
          ? "Select a budget from the setup section above."
          : "Connect to an Actual server and select a budget.",
      );
      return;
    }
    const body = req.body as ImportBody;
    const session = sessions.get(body.sessionId ?? "");
    if (!session) {
      sendError(
        res,
        404,
        "Preview session not found or expired.",
        "Upload and preview your file again. Sessions expire after 30 minutes of inactivity.",
      );
      return;
    }

    try {
      const accounts = await listAccounts();
      const mappingRequest: MappingRequest = {
        fieldMapping: body.mapping ?? {},
        accountValueMap: body.accountValueMap ?? {},
        defaultAccountId: body.defaultAccountId,
        amountOptions: body.amountOptions,
      };
      const dateFiltered = applyDateFilter(session.rows, body.mapping?.date, {
        beforeDate: body.beforeDate,
        afterDate: body.afterDate,
      });
      for (const warning of dateFiltered.warnings) {
        console.warn(`[api/import] ${warning}`);
      }

      const mapped = mapRowsForImport(dateFiltered.rows, accounts, mappingRequest);
      if (mapped.rowErrors.length > 0 && !body.allowPartial) {
        res.status(400).json({
          error:
            "Some rows could not be mapped to valid transactions. Map all account values, set a default account, or enable “Allow partial import” to skip invalid rows.",
          rowErrors: mapped.rowErrors,
        });
        return;
      }

      const imports: Array<{ accountId: string; count: number; result: unknown }> = [];
      for (const [accountId, transactions] of mapped.byAccountId.entries()) {
        const result = await importIntoAccount(accountId, transactions, Boolean(body.dryRun));
        imports.push({ accountId, count: transactions.length, result });
      }

      res.json({
        ok: true,
        dryRun: Boolean(body.dryRun),
        dateFilterExcludedRows: dateFiltered.excludedCount,
        importedRows: imports.reduce((sum, item) => sum + item.count, 0),
        rowErrors: mapped.rowErrors,
        imports,
      });
    } catch (err) {
      const { message, hint } = toUserFacingError(err);
      sendError(res, 500, message, hint);
    }
  }),
);

app.use((_req, res) => {
  sendError(res, 404, "Page not found.", "Check the URL or go back to the home page.");
});

app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  const { message, hint } = toUserFacingError(err);
  sendError(res, 500, message, hint);
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const server = app.listen(port, host, () => {
  console.log(`Server running on http://${host}:${port}`);
});

process.on("SIGINT", async () => {
  server.close();
  await closeActual();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  server.close();
  await closeActual();
  process.exit(0);
});
