import { parseFileWithActual } from "../actual/client";
import type {
  FieldMapping,
  NormalizedRow,
  ParseFileOptions,
  ParseError,
  ParsedDelimitedTransaction,
  ParsedStructuredTransaction,
  PreviewPayload,
} from "../types";
import { detectFormatFromPath } from "./formats";

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === "string");
}

function isStructuredRow(value: unknown): value is ParsedStructuredTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as ParsedStructuredTransaction;
  return typeof row.date === "string" || typeof row.amount === "number";
}

function toRawRecord(row: ParsedDelimitedTransaction): Record<string, string> {
  if (Array.isArray(row)) {
    return Object.fromEntries(row.map((value, idx) => [`column_${idx + 1}`, value ?? ""]));
  }

  if (isStringRecord(row)) {
    return { ...row };
  }

  return {};
}

function mergeColumnNames(rows: NormalizedRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.raw)) {
      seen.add(key);
    }
  }
  return Array.from(seen.values());
}

const COLUMN_CANDIDATES: Record<keyof FieldMapping, string[]> = {
  date: ["date", "transaction date", "posted date"],
  amount: ["amount", "amt", "value"],
  inflow: ["inflow", "credit", "money in", "deposit"],
  outflow: ["outflow", "debit", "money out", "withdrawal", "payment"],
  inOut: ["type", "in/out", "in out", "debit/credit", "direction"],
  payeeName: ["payee", "name", "merchant", "description"],
  importedPayee: ["original payee", "bank description", "imported payee"],
  notes: ["notes", "memo", "description", "note"],
  importedId: ["imported id", "fitid", "id", "transaction id"],
  account: ["account", "account name", "source account", "acct"],
  cleared: ["cleared", "status", "reconciled"],
};

function inferFieldMapping(columns: string[]): FieldMapping {
  const lowerMap = new Map(columns.map((name) => [name.toLowerCase(), name]));
  const inferred: FieldMapping = {};

  for (const [field, candidates] of Object.entries(COLUMN_CANDIDATES) as Array<
    [keyof FieldMapping, string[]]
  >) {
    const hit = candidates.find((candidate) => lowerMap.has(candidate));
    if (hit) {
      inferred[field] = lowerMap.get(hit);
    }
  }

  return inferred;
}

function uniqueAccountValues(rows: NormalizedRow[], mapping: FieldMapping): string[] {
  if (!mapping.account) {
    return [];
  }
  const values = new Set<string>();
  for (const row of rows) {
    const value = row.raw[mapping.account]?.trim();
    if (value) {
      values.add(value);
    }
  }
  return Array.from(values.values()).sort((a, b) => a.localeCompare(b));
}

export function normalizeParsedTransactions(
  transactions: Array<ParsedDelimitedTransaction | ParsedStructuredTransaction> | undefined,
): NormalizedRow[] {
  const rows: NormalizedRow[] = [];

  for (const [index, txn] of (transactions ?? []).entries()) {
    if (isStructuredRow(txn)) {
      rows.push({
        rowNumber: index + 1,
        raw: {},
        structured: txn,
      });
      continue;
    }

    rows.push({
      rowNumber: index + 1,
      raw: toRawRecord(txn as ParsedDelimitedTransaction),
      structured: null,
    });
  }

  return rows;
}

export async function parseAndNormalizeFile(
  filePath: string,
  options: ParseFileOptions,
): Promise<{ rows: NormalizedRow[]; errors: ParseError[]; format: PreviewPayload["format"] }> {
  const format = detectFormatFromPath(filePath);
  if (format === "unknown") {
    throw new Error(
      "Unsupported file format. Use a file with extension .csv, .tsv, .qif, .ofx, .qfx, or .xml.",
    );
  }
  const parsed = await parseFileWithActual(filePath, options);
  const rows = normalizeParsedTransactions(parsed.transactions);

  return { rows, errors: parsed.errors ?? [], format };
}

export function buildPreviewPayload(
  rows: NormalizedRow[],
  errors: ParseError[],
  format: PreviewPayload["format"],
): PreviewPayload {
  const columns = mergeColumnNames(rows);
  const inferredMapping = inferFieldMapping(columns);
  const accountValues = uniqueAccountValues(rows, inferredMapping);

  return {
    format,
    errors,
    columns,
    inferredMapping,
    uniqueAccountValues: accountValues,
    sampleRows: rows.slice(0, 25),
    totalRows: rows.length,
  };
}
