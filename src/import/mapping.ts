import { internal } from "@actual-app/api";

import type {
  AccountRef,
  FieldMapping,
  MapRowsResult,
  MappingRequest,
  NormalizedRow,
  PreparedImportTransaction,
  RowValidationError,
} from "../types";

type ResolveAccountContext = {
  byId: Map<string, AccountRef>;
  byName: Map<string, AccountRef>;
  mapping: Record<string, string>;
  defaultAccountId?: string;
};

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function parseMoney(raw: string | number | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return internal.amountToInteger(raw);
  }

  const source = String(raw ?? "").trim();
  if (!source) {
    return null;
  }

  let normalized = source.replace(/[$,\s]/g, "");
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = `-${normalized.slice(1, -1)}`;
  }
  normalized = normalized.replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === ".") {
    return null;
  }
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount)) {
    return null;
  }
  return internal.amountToInteger(amount);
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "cleared"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "uncleared"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function getMappedValue(raw: Record<string, string>, key?: string): string | undefined {
  if (!key) {
    return undefined;
  }
  return raw[key];
}

function resolveAccountId(
  rawAccountValue: string | undefined,
  ctx: ResolveAccountContext,
): string | null {
  const trimmed = rawAccountValue?.trim();
  if (!trimmed) {
    return ctx.defaultAccountId ?? null;
  }

  // 1) Explicit account-value map is highest priority.
  const explicitMapTarget = ctx.mapping[trimmed];
  if (explicitMapTarget) {
    const mappedById = ctx.byId.get(explicitMapTarget);
    if (mappedById) {
      return mappedById.id;
    }

    const mappedByName = ctx.byName.get(explicitMapTarget.toLowerCase());
    if (mappedByName) {
      return mappedByName.id;
    }
  }

  // 2) Then try matching the imported value directly to existing accounts.
  const byId = ctx.byId.get(trimmed);
  if (byId) {
    return byId.id;
  }

  const byName = ctx.byName.get(trimmed.toLowerCase());
  if (byName) {
    return byName.id;
  }

  // 3) Default account is a final fallback.
  return ctx.defaultAccountId ?? null;
}

function stringOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildFromStructuredRow(row: NormalizedRow): PreparedImportTransaction | null {
  const data = row.structured;
  if (!data) {
    return null;
  }

  const normalizedDate = data.date ? normalizeDate(data.date) : null;
  const amount = parseMoney(data.amount ?? undefined);
  if (!normalizedDate || amount === null) {
    return null;
  }

  return {
    date: normalizedDate,
    amount,
    payee_name: stringOrUndefined(data.payee_name),
    imported_payee: stringOrUndefined(data.imported_payee),
    notes: stringOrUndefined(data.notes),
    imported_id: stringOrUndefined(data.imported_id),
    cleared: typeof data.cleared === "boolean" ? data.cleared : undefined,
  };
}

function buildFromMappedRow(
  row: NormalizedRow,
  mapping: FieldMapping,
): PreparedImportTransaction | null {
  const dateRaw = getMappedValue(row.raw, mapping.date);
  const date = dateRaw ? normalizeDate(dateRaw) : null;
  if (!date) {
    return null;
  }

  let amount: number | null = null;
  if (mapping.amount) {
    amount = parseMoney(getMappedValue(row.raw, mapping.amount));
  } else if (mapping.inflow || mapping.outflow) {
    const inflow = parseMoney(getMappedValue(row.raw, mapping.inflow)) ?? 0;
    const outflow = parseMoney(getMappedValue(row.raw, mapping.outflow)) ?? 0;
    amount = inflow - outflow;
  }

  if (amount === null) {
    return null;
  }

  return {
    date,
    amount,
    payee_name: stringOrUndefined(getMappedValue(row.raw, mapping.payeeName)),
    imported_payee: stringOrUndefined(getMappedValue(row.raw, mapping.importedPayee)),
    notes: stringOrUndefined(getMappedValue(row.raw, mapping.notes)),
    imported_id: stringOrUndefined(getMappedValue(row.raw, mapping.importedId)),
    cleared: parseBoolean(getMappedValue(row.raw, mapping.cleared)),
  };
}

function buildAccountContext(
  accounts: AccountRef[],
  request: MappingRequest,
): ResolveAccountContext {
  return {
    byId: new Map(accounts.map((account) => [account.id, account])),
    byName: new Map(accounts.map((account) => [account.name.toLowerCase(), account])),
    mapping: request.accountValueMap ?? {},
    defaultAccountId: request.defaultAccountId,
  };
}

export function mapRowsForImport(
  rows: NormalizedRow[],
  accounts: AccountRef[],
  request: MappingRequest,
): MapRowsResult {
  const ctx = buildAccountContext(accounts, request);
  const rowErrors: RowValidationError[] = [];
  const byAccountId = new Map<string, PreparedImportTransaction[]>();

  for (const row of rows) {
    const mappedTxn = row.structured
      ? buildFromStructuredRow(row)
      : buildFromMappedRow(row, request.fieldMapping);
    if (!mappedTxn) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        message: "Could not build a valid transaction from this row",
      });
      continue;
    }

    const accountValue =
      row.structured?.account ?? getMappedValue(row.raw, request.fieldMapping.account);
    const accountId = resolveAccountId(accountValue ?? undefined, ctx);
    if (!accountId) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        message: `Could not resolve account for value "${accountValue ?? ""}"`,
      });
      continue;
    }

    const existing = byAccountId.get(accountId);
    if (existing) {
      existing.push(mappedTxn);
    } else {
      byAccountId.set(accountId, [mappedTxn]);
    }
  }

  return { byAccountId, rowErrors };
}
