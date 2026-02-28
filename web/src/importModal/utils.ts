import { isValid, parseISO } from "date-fns";

export type DateFormat =
  | "yyyy mm dd"
  | "yy mm dd"
  | "mm dd yyyy"
  | "mm dd yy"
  | "dd mm yyyy"
  | "dd mm yy";

export const dateFormats = [
  { format: "yyyy mm dd", label: "YYYY MM DD" },
  { format: "yy mm dd", label: "YY MM DD" },
  { format: "mm dd yyyy", label: "MM DD YYYY" },
  { format: "mm dd yy", label: "MM DD YY" },
  { format: "dd mm yyyy", label: "DD MM YYYY" },
  { format: "dd mm yy", label: "DD MM YY" },
] as const;

export type ImportTransaction = Record<string, unknown> & {
  trx_id: string;
  selected?: boolean;
  date?: string;
  amount?: number | string;
  payee_name?: string;
  imported_payee?: string;
  notes?: string;
  category?: string;
  inOut?: string;
  inflow?: string | number;
  outflow?: string | number;
};

export type FieldMapping = {
  date: string | null;
  amount: string | null;
  payee: string | null;
  notes: string | null;
  category: string | null;
  inOut: string | null;
  inflow: string | null;
  outflow: string | null;
  account: string | null;
  importedId: string | null;
};

function looselyParseAmount(value: string): number | null {
  let cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = `-${cleaned.slice(1, -1)}`;
  }
  cleaned = cleaned.replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") {
    return null;
  }
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDate(str: unknown, order: DateFormat): string | null {
  if (typeof str !== "string") {
    return null;
  }

  const pad = (v: string) => (v && v.length === 1 ? `0${v}` : v);
  const dateGroups = (a: number, b: number) => (source: string) => {
    const parts = source
      .replace(/\bjan(\.|uary)?\b/i, "01")
      .replace(/\bfeb(\.|ruary)?\b/i, "02")
      .replace(/\bmar(\.|ch)?\b/i, "03")
      .replace(/\bapr(\.|il)?\b/i, "04")
      .replace(/\bmay\.?\b/i, "05")
      .replace(/\bjun(\.|e)?\b/i, "06")
      .replace(/\bjul(\.|y)?\b/i, "07")
      .replace(/\baug(\.|ust)?\b/i, "08")
      .replace(/\bsep(\.|tember)?\b/i, "09")
      .replace(/\boct(\.|ober)?\b/i, "10")
      .replace(/\bnov(\.|ember)?\b/i, "11")
      .replace(/\bdec(\.|ember)?\b/i, "12")
      .replace(/^[^\d]+/, "")
      .replace(/[^\d]+$/, "")
      .split(/[^\d]+/);
    if (parts.length >= 3) {
      return parts.slice(0, 3);
    }
    const digits = source.replace(/[^\d]/g, "");
    return [digits.slice(0, a), digits.slice(a, a + b), digits.slice(a + b)];
  };

  const yearFirst = dateGroups(4, 2);
  const twoDig = dateGroups(2, 2);
  let year = "";
  let month = "";
  let day = "";
  let parts: string[] = [];

  switch (order) {
    case "dd mm yyyy":
      parts = twoDig(str);
      [day, month, year] = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
      break;
    case "dd mm yy":
      parts = twoDig(str);
      [day, month, year] = [parts[0] ?? "", parts[1] ?? "", `20${parts[2] ?? ""}`];
      break;
    case "yyyy mm dd":
      parts = yearFirst(str);
      [year, month, day] = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
      break;
    case "yy mm dd":
      parts = twoDig(str);
      [year, month, day] = [`20${parts[0] ?? ""}`, parts[1] ?? "", parts[2] ?? ""];
      break;
    case "mm dd yy":
      parts = twoDig(str);
      [month, day, year] = [parts[0] ?? "", parts[1] ?? "", `20${parts[2] ?? ""}`];
      break;
    case "mm dd yyyy":
    default:
      parts = twoDig(str);
      [month, day, year] = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
      break;
  }

  const parsed = `${year}-${pad(month)}-${pad(day)}`;
  if (!isValid(parseISO(parsed))) {
    return null;
  }
  return parsed;
}

export function applyFieldMappings(transaction: ImportTransaction, mappings: FieldMapping) {
  const result: Record<string, unknown> = {};
  for (const [originalField, target] of Object.entries(mappings)) {
    if (!target) continue;
    const field = originalField === "payee" ? "payee_name" : originalField;
    result[field] = transaction[target] ?? "";
  }
  result.trx_id = transaction.trx_id;
  result.selected = transaction.selected ?? true;
  return result as ImportTransaction;
}

function parseAmount(amount: unknown, mapper: (parsed: number) => number) {
  if (amount == null) return null;
  const parsed = typeof amount === "string" ? looselyParseAmount(amount) : Number(amount);
  if (parsed == null || !Number.isFinite(parsed)) return null;
  return mapper(parsed);
}

export function parseAmountFields(
  trans: Partial<ImportTransaction>,
  splitMode: boolean,
  inOutMode: boolean,
  outValue: string,
  flipAmount: boolean,
  multiplierAmount: string,
) {
  const multiplier = Number.parseFloat(multiplierAmount) || 1;
  const value = { outflow: 0, inflow: 0 };

  if (splitMode && !inOutMode) {
    value.outflow = parseAmount(trans.outflow, (n) => -Math.abs(n)) || 0;
    value.inflow = value.outflow ? 0 : parseAmount(trans.inflow, (n) => Math.abs(n)) || 0;
  } else {
    const amount = parseAmount(trans.amount, (n) => n) || 0;
    if (amount >= 0) value.inflow = amount;
    else value.outflow = amount;
  }

  if (inOutMode) {
    const transactionValue = value.outflow || value.inflow;
    const inOutVal = String(trans.inOut ?? "").trim().toLowerCase();
    const outVal = outValue.trim().toLowerCase();
    if (inOutVal === outVal) {
      value.outflow = -Math.abs(transactionValue);
      value.inflow = 0;
    } else {
      value.inflow = Math.abs(transactionValue);
      value.outflow = 0;
    }
  }

  if (flipAmount) {
    const oldInflow = value.inflow;
    value.inflow = Math.abs(value.outflow);
    value.outflow = -Math.abs(oldInflow);
  }

  value.inflow *= multiplier;
  value.outflow *= multiplier;

  return {
    amount: value.outflow || value.inflow,
    outflow: splitMode ? value.outflow : null,
    inflow: splitMode ? value.inflow : null,
  };
}

export function stripCsvImportTransaction(transaction: ImportTransaction) {
  const { trx_id: _trxId, selected: _selected, ...trans } = transaction;
  return trans;
}
