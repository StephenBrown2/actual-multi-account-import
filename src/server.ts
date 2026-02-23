#!/usr/bin/env node
import { rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import multer from "multer";

import { closeActual, importIntoAccount, initActual, listAccounts } from "./actual/client";
import { toUserFacingError } from "./errors";

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  return (req, res, next) => {
    void fn(req, res).catch(next);
  };
}
import { mapRowsForImport } from "./import/mapping";
import { buildPreviewPayload, parseAndNormalizeFile } from "./import/parse";
import type { FieldMapping, MappingRequest, NormalizedRow, ParseFileOptions } from "./types";

dotenv.config();

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
  dryRun?: boolean;
  allowPartial?: boolean;
};

const sessions = new Map<string, PreviewSession>();
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

async function initializeFromEnv(): Promise<void> {
  const serverURL = process.env.ACTUAL_SERVER_URL;
  if (!serverURL) {
    throw new Error(
      "ACTUAL_SERVER_URL is required. Set it in your environment or .env file (e.g. ACTUAL_SERVER_URL=https://your-actual-server.com).",
    );
  }

  await initActual({
    serverURL,
    password: process.env.ACTUAL_PASSWORD,
    sessionToken: process.env.ACTUAL_SESSION_TOKEN,
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
  try {
    await initializeFromEnv();
  } catch (err) {
    const { message, hint } = toUserFacingError(err);
    console.error(message);
    if (hint) console.error(hint);
    process.exit(1);
  }
  if (!existsSync(join(webRoot, "index.html"))) {
    console.error(
      "Web UI not built. Run 'npm run web:build' or 'npm run server' (which builds automatically) before starting. Expected files at:",
      webRoot,
    );
    process.exit(1);
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
  "/api/accounts",
  asyncHandler(async (_req, res) => {
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
      };
      const mapped = mapRowsForImport(session.rows, accounts, mappingRequest);
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
const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
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
