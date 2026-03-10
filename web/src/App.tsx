import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { fetchJson, formatApiError } from "./api";
import { FieldMappings } from "./importModal/FieldMappings";
import { applyFieldMappings, dateFormats, parseAmountFields, parseDate } from "./importModal/utils";
import type { DateFormat, FieldMapping, ImportTransaction } from "./importModal/utils";

type Account = { id: string; name: string; closed?: boolean; offbudget?: boolean };

type BudgetRef = {
  id: string | null;
  name: string;
  groupId?: string;
  cloudFileId?: string;
  syncId?: string;
};

type ConnectionStatus = {
  connected: boolean;
  budgetLoaded: boolean;
  currentBudgetId?: string | null;
  budgets?: BudgetRef[];
};
type PreviewResponse = {
  sessionId: string;
  format: string;
  errors: Array<{ message: string; internal: string }>;
  columns: string[];
  inferredMapping: Record<string, string | undefined>;
  uniqueAccountValues: string[];
  sampleRows: Array<{
    rowNumber: number;
    raw: Record<string, string>;
    structured: Record<string, unknown> | null;
  }>;
  totalRows: number;
};

const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".qif", ".ofx", ".qfx", ".xml"];

const PREFERENCES_STORAGE_KEY = "actual-multi-account-import:preferences";

type SavedPreferences = Partial<{
  mapping: FormState["mapping"];
  defaultAccountId: string;
  accountValueMap: Record<string, string>;
  hasHeaderRow: boolean;
  delimiter: string;
  skipStartLines: number;
  skipEndLines: number;
  splitMode: boolean;
  inOutMode: boolean;
  outValue: string;
  flipAmount: boolean;
  multiplierAmount: string;
  parseDateFormat: FormState["parseDateFormat"];
}>;

function loadPreferences(budgetId: string): SavedPreferences | null {
  try {
    const raw = localStorage.getItem(`${PREFERENCES_STORAGE_KEY}:${budgetId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedPreferences;
  } catch {
    return null;
  }
}

function savePreferences(budgetId: string, form: FormState): void {
  try {
    const prefs: SavedPreferences = {
      mapping: form.mapping,
      defaultAccountId: form.defaultAccountId,
      accountValueMap: form.accountValueMap,
      hasHeaderRow: form.hasHeaderRow,
      delimiter: form.delimiter,
      skipStartLines: form.skipStartLines,
      skipEndLines: form.skipEndLines,
      splitMode: form.splitMode,
      inOutMode: form.inOutMode,
      outValue: form.outValue,
      flipAmount: form.flipAmount,
      multiplierAmount: form.multiplierAmount,
      parseDateFormat: form.parseDateFormat,
    };
    localStorage.setItem(`${PREFERENCES_STORAGE_KEY}:${budgetId}`, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

type ImportApiResponse = {
  imports?: Array<{ accountId: string; count: number; result: unknown }>;
  error?: string;
  hint?: string;
  rowErrors?: Array<{ rowNumber: number; message: string }>;
} & Record<string, unknown>;

type PreviewRow = {
  id: string;
  date: string;
  payee: string;
  notes: string;
  amount: number | null;
  inflow: number | null;
  outflow: number | null;
  account: string;
};

type FormState = {
  mapping: FieldMapping;
  defaultAccountId: string;
  accountValueMap: Record<string, string>;
  hasHeaderRow: boolean;
  delimiter: string;
  skipStartLines: number;
  skipEndLines: number;
  importNotes: boolean;
  fallbackMissingPayeeToMemo: boolean;
  splitMode: boolean;
  inOutMode: boolean;
  outValue: string;
  flipAmount: boolean;
  multiplierAmount: string;
  parseDateFormat: DateFormat;
  dryRun: boolean;
  allowPartial: boolean;
  file: File | null;
};

type FormAction =
  | { type: "PATCH"; patch: Partial<FormState> }
  | { type: "SET_MAPPING_FIELD"; field: keyof FieldMapping; value: string | null }
  | { type: "SET_ACCOUNT_VALUE_MAP"; sourceValue: string; accountId: string }
  | { type: "RESET_FOR_PREVIEW"; mapping: FieldMapping };

const DEFAULT_MAPPING: FieldMapping = {
  date: null,
  amount: null,
  payee: null,
  notes: null,
  category: null,
  inOut: null,
  inflow: null,
  outflow: null,
  account: null,
  importedId: null,
};

const INITIAL_FORM_STATE: FormState = {
  mapping: DEFAULT_MAPPING,
  defaultAccountId: "",
  accountValueMap: {},
  hasHeaderRow: true,
  delimiter: ",",
  skipStartLines: 0,
  skipEndLines: 0,
  importNotes: true,
  fallbackMissingPayeeToMemo: false,
  splitMode: false,
  inOutMode: false,
  outValue: "",
  flipAmount: false,
  multiplierAmount: "",
  parseDateFormat: "mm dd yyyy",
  dryRun: true,
  allowPartial: false,
  file: null,
};

function inferInitialMappings(preview: PreviewResponse): FieldMapping {
  const inferred = preview?.inferredMapping ?? {};
  return {
    ...DEFAULT_MAPPING,
    date: inferred.date ?? null,
    amount: inferred.amount ?? null,
    payee: inferred.payeeName ?? null,
    notes: inferred.notes ?? null,
    inOut: inferred.inOut ?? null,
    category: inferred.category ?? null,
    outflow: inferred.outflow ?? null,
    inflow: inferred.inflow ?? null,
    account: inferred.account ?? null,
    importedId: inferred.importedId ?? null,
  };
}

function toImportTransactions(preview: PreviewResponse): ImportTransaction[] {
  const rows = preview?.sampleRows ?? [];
  return rows.map((row) => ({
    ...(row.structured ?? row.raw),
    trx_id: String(row.rowNumber),
    selected: true,
  })) as ImportTransaction[];
}

function parseMappedDate(value: unknown, format: DateFormat): string | null {
  if (typeof value !== "string") return null;
  return parseDate(value, format);
}

function toNonNegativeInt(value: string): number {
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

function formReducer(state: FormState, action: FormAction): FormState {
  if (action.type === "PATCH") {
    return { ...state, ...action.patch };
  }

  if (action.type === "SET_MAPPING_FIELD") {
    return {
      ...state,
      mapping: {
        ...state.mapping,
        [action.field]: action.value,
      },
    };
  }

  if (action.type === "SET_ACCOUNT_VALUE_MAP") {
    return {
      ...state,
      accountValueMap: {
        ...state.accountValueMap,
        [action.sourceValue]: action.accountId,
      },
    };
  }

  if (action.type === "RESET_FOR_PREVIEW") {
    return {
      ...state,
      mapping: action.mapping,
    };
  }

  return state;
}

type ParseOptionsSectionProps = {
  form: FormState;
  onSubmit: (event: React.FormEvent) => void;
  onPatch: (patch: Partial<FormState>) => void;
  /** When this changes, the file input is reset (e.g. when switching budgets). */
  fileResetTrigger?: string;
};

function ParseOptionsSection({
  form,
  onSubmit,
  onPatch,
  fileResetTrigger,
}: ParseOptionsSectionProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fileResetTrigger !== undefined && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [fileResetTrigger]);

  return (
    <section className="card">
      <h2>1) Select File and Parse Options</h2>
      <form onSubmit={onSubmit}>
        <label>
          Import file
          <input
            ref={fileInputRef}
            type="file"
            required
            onChange={(event) => onPatch({ file: event.target.files?.[0] ?? null })}
            accept=".csv,.tsv,.qif,.ofx,.qfx,.xml"
          />
        </label>
        <div className="grid">
          <label>
            <input
              type="checkbox"
              checked={form.hasHeaderRow}
              onChange={() => onPatch({ hasHeaderRow: !form.hasHeaderRow })}
            />
            Has header row
          </label>
          <label>
            Delimiter
            <input
              type="text"
              value={form.delimiter}
              onChange={(event) => onPatch({ delimiter: event.target.value })}
            />
          </label>
          <label>
            Skip start lines
            <input
              type="number"
              value={form.skipStartLines}
              onChange={(event) =>
                onPatch({ skipStartLines: toNonNegativeInt(event.target.value) })
              }
            />
          </label>
          <label>
            Skip end lines
            <input
              type="number"
              value={form.skipEndLines}
              onChange={(event) => onPatch({ skipEndLines: toNonNegativeInt(event.target.value) })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.importNotes}
              onChange={() => onPatch({ importNotes: !form.importNotes })}
            />
            Import notes/memo
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.fallbackMissingPayeeToMemo}
              onChange={() =>
                onPatch({
                  fallbackMissingPayeeToMemo: !form.fallbackMissingPayeeToMemo,
                })
              }
            />
            OFX/QFX fallback payee to memo
          </label>
        </div>
        <button type="submit">Preview File</button>
      </form>
    </section>
  );
}

type AmountOptionsSectionProps = {
  form: FormState;
  onPatch: (patch: Partial<FormState>) => void;
};

function AmountOptionsSection({ form, onPatch }: AmountOptionsSectionProps): React.JSX.Element {
  return (
    <section className="card">
      <h3>Amount Options</h3>
      <div className="grid">
        <label>
          <input
            type="checkbox"
            checked={form.splitMode}
            onChange={() => onPatch({ splitMode: !form.splitMode })}
          />
          Split inflow/outflow columns
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.inOutMode}
            onChange={() => onPatch({ inOutMode: !form.inOutMode })}
          />
          In/Out mode
        </label>
        <label>
          Out value
          <input
            type="text"
            value={form.outValue}
            onChange={(event) => onPatch({ outValue: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.flipAmount}
            onChange={() => onPatch({ flipAmount: !form.flipAmount })}
          />
          Flip amount
        </label>
        <label>
          Multiplier
          <input
            type="text"
            value={form.multiplierAmount}
            onChange={(event) => onPatch({ multiplierAmount: event.target.value })}
            placeholder="1.0"
          />
        </label>
        <label>
          Date format
          <select
            value={form.parseDateFormat}
            onChange={(event) => onPatch({ parseDateFormat: event.target.value as DateFormat })}
          >
            {dateFormats.map((format) => (
              <option key={format.format} value={format.format}>
                {format.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

type AccountMappingSectionProps = {
  form: FormState;
  accounts: Account[];
  uniqueAccountValues: string[];
  onPatch: (patch: Partial<FormState>) => void;
  onAccountValueMapChange: (sourceValue: string, accountId: string) => void;
};

function AccountMappingSection({
  form,
  accounts,
  uniqueAccountValues,
  onPatch,
  onAccountValueMapChange,
}: AccountMappingSectionProps): React.JSX.Element {
  return (
    <section className="card">
      <h3>Account Mapping</h3>
      <div className="grid">
        <label>
          Default account
          <select
            value={form.defaultAccountId}
            onChange={(event) => onPatch({ defaultAccountId: event.target.value })}
          >
            <option value="">(none)</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        {uniqueAccountValues.map((value) => (
          <label key={value}>
            Value: {value}
            <select
              value={form.accountValueMap[value] ?? ""}
              onChange={(event) => onAccountValueMapChange(value, event.target.value)}
            >
              <option value="">(unmapped)</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

type PreviewSectionProps = {
  preview: PreviewResponse;
  previewRows: PreviewRow[];
};

function PreviewSection({ preview, previewRows }: PreviewSectionProps): React.JSX.Element {
  return (
    <section className="card">
      <h2>2) Preview Transactions</h2>
      <p>
        Format: <strong>{preview.format}</strong> | Parsed rows:{" "}
        <strong>{preview.totalRows}</strong> | Parse errors:{" "}
        <strong>{preview.errors.length}</strong>
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Payee</th>
              <th>Notes</th>
              <th>Amount</th>
              <th>Outflow</th>
              <th>Inflow</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{row.payee}</td>
                <td>{row.notes}</td>
                <td>{row.amount ?? ""}</td>
                <td>{row.outflow ?? ""}</td>
                <td>{row.inflow ?? ""}</td>
                <td>{row.account}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ImportSectionProps = {
  form: FormState;
  selectedCount: number;
  onPatch: (patch: Partial<FormState>) => void;
  onImport: () => Promise<void>;
  onSavePreferences?: () => void;
};

function ImportSection({
  form,
  selectedCount,
  onPatch,
  onImport,
  onSavePreferences,
}: ImportSectionProps): React.JSX.Element {
  const [savedFeedback, setSavedFeedback] = useState(false);

  return (
    <section className="card">
      <h2>3) Import</h2>
      <div className="actions">
        <label>
          <input
            type="checkbox"
            checked={form.dryRun}
            onChange={() => onPatch({ dryRun: !form.dryRun })}
          />
          Dry run only
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.allowPartial}
            onChange={() => onPatch({ allowPartial: !form.allowPartial })}
          />
          Allow partial import
        </label>
        <button onClick={() => void onImport()} disabled={selectedCount === 0}>
          Import {selectedCount} transactions
        </button>
        {onSavePreferences && (
          <button
            type="button"
            onClick={() => {
              onSavePreferences();
              setSavedFeedback(true);
              setTimeout(() => setSavedFeedback(false), 2000);
            }}
            className="secondary"
          >
            {savedFeedback ? "Saved!" : "Save preferences"}
          </button>
        )}
      </div>
    </section>
  );
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connectLoading, setConnectLoading] = useState(false);
  const [selectBudgetLoading, setSelectBudgetLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [transactions, setTransactions] = useState<ImportTransaction[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM_STATE);

  const selectedCount = transactions.filter((transaction) => transaction.selected).length;

  const previewRows = useMemo<PreviewRow[]>(() => {
    return transactions.slice(0, 25).map((transaction) => {
      const mapped = applyFieldMappings(transaction, form.mapping);
      const parsedDate = parseMappedDate(mapped.date, form.parseDateFormat);
      const { amount, inflow, outflow } = parseAmountFields(
        mapped,
        form.splitMode,
        form.inOutMode,
        form.outValue,
        form.flipAmount,
        form.multiplierAmount,
      );
      return {
        id: transaction.trx_id,
        date: parsedDate ?? String(mapped.date ?? ""),
        payee: String(mapped.payee_name ?? ""),
        notes: String(mapped.notes ?? ""),
        amount,
        inflow,
        outflow,
        account: String(mapped.account ?? ""),
      };
    });
  }, [
    transactions,
    form.mapping,
    form.parseDateFormat,
    form.splitMode,
    form.inOutMode,
    form.outValue,
    form.flipAmount,
    form.multiplierAmount,
  ]);

  async function fetchStatus(): Promise<void> {
    setStatusLoading(true);
    setError(null);
    try {
      const { ok, data } = await fetchJson<ConnectionStatus>("/api/status");
      if (!ok) {
        setStatus(null);
        return;
      }
      setStatus({
        connected: data.connected ?? false,
        budgetLoaded: data.budgetLoaded ?? false,
        currentBudgetId: data.currentBudgetId,
        budgets: data.budgets,
      });
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }

  async function fetchAccounts(): Promise<void> {
    setError(null);
    try {
      const { ok, data } = await fetchJson<{ accounts?: Account[] }>("/api/accounts");
      if (!ok) {
        setError(formatApiError(data));
        setAccounts([]);
        return;
      }
      setAccounts(data.accounts ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load accounts.";
      setError(
        `${message}\n\nCheck that the server is running and ACTUAL_SERVER_URL, ACTUAL_PASSWORD (or ACTUAL_SESSION_TOKEN) are set correctly.`,
      );
      setAccounts([]);
    }
  }

  React.useEffect(() => {
    void fetchStatus();
  }, []);

  React.useEffect(() => {
    if (status?.budgetLoaded) {
      void fetchAccounts();
    } else {
      setAccounts([]);
    }
  }, [status?.budgetLoaded]);

  React.useEffect(() => {
    if (status?.currentBudgetId) {
      const prefs = loadPreferences(status.currentBudgetId);
      if (prefs && Object.keys(prefs).length > 0) {
        dispatch({ type: "PATCH", patch: prefs });
      }
    }
  }, [status?.currentBudgetId]);

  async function onPreview(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!form.file) {
      setError(
        "No file selected.\n\nChoose a transaction file (CSV, TSV, QIF, OFX, QFX, or XML) and try again.",
      );
      return;
    }

    const dotIdx = form.file.name.toLowerCase().lastIndexOf(".");
    const ext = dotIdx >= 0 ? form.file.name.toLowerCase().slice(dotIdx) : "";
    if (!ext || !SUPPORTED_EXTENSIONS.includes(ext)) {
      const msg = ext ? `Unsupported file type "${ext}".` : "File has no extension.";
      setError(
        `${msg}\n\nUse a file with one of these extensions: ${SUPPORTED_EXTENSIONS.join(", ")}`,
      );
      return;
    }

    const requestData = new FormData();
    requestData.append("file", form.file);
    requestData.append("hasHeaderRow", String(form.hasHeaderRow));
    requestData.append("delimiter", form.delimiter);
    requestData.append("skipStartLines", String(form.skipStartLines));
    requestData.append("skipEndLines", String(form.skipEndLines));
    requestData.append("importNotes", String(form.importNotes));
    requestData.append("fallbackMissingPayeeToMemo", String(form.fallbackMissingPayeeToMemo));

    try {
      const { ok, data } = await fetchJson<PreviewResponse>("/api/preview", {
        method: "POST",
        body: requestData,
      });
      if (!ok) {
        setError(formatApiError(data));
        setPreview(null);
        setTransactions([]);
        return;
      }
      setPreview(data);
      setTransactions(toImportTransactions(data));
      const inferred = inferInitialMappings(data);
      const prefs = status?.currentBudgetId ? loadPreferences(status.currentBudgetId) : null;
      const columns = new Set(data.columns ?? []);
      const mergedMapping = { ...inferred };
      if (prefs?.mapping) {
        for (const [field, col] of Object.entries(prefs.mapping)) {
          if (col && columns.has(col)) {
            mergedMapping[field as keyof typeof mergedMapping] = col;
          }
        }
      }
      dispatch({ type: "RESET_FOR_PREVIEW", mapping: mergedMapping });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to preview file.";
      setError(
        `${message}\n\nEnsure the file is a valid CSV, TSV, QIF, OFX, QFX, or XML file. Check parse options (header row, delimiter) if the format looks correct.`,
      );
      setPreview(null);
      setTransactions([]);
    }
  }

  async function onConnect(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const serverURL = (
      form.elements.namedItem("serverURL") as HTMLInputElement | null
    )?.value?.trim();
    const password = (form.elements.namedItem("password") as HTMLInputElement | null)?.value;
    const sessionToken = (
      form.elements.namedItem("sessionToken") as HTMLInputElement | null
    )?.value?.trim();
    if (!serverURL || (!password && !sessionToken)) {
      setError("Enter server URL and either password or session token.");
      return;
    }
    setError(null);
    setConnectLoading(true);
    try {
      const { ok, data } = await fetchJson<{ connected?: boolean; budgets?: BudgetRef[] }>(
        "/api/connect",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            serverURL,
            password: password || undefined,
            sessionToken: sessionToken || undefined,
          }),
        },
      );
      if (!ok) {
        setError(formatApiError(data));
        return;
      }
      setStatus({
        connected: true,
        budgetLoaded: false,
        budgets: data.budgets ?? [],
      });
    } finally {
      setConnectLoading(false);
    }
  }

  async function onSelectBudget(value: string): Promise<void> {
    if (!value) return;
    setError(null);
    setSelectBudgetLoading(true);
    try {
      const isSync = value.startsWith("sync:");
      const body = isSync ? { syncId: value.slice(5) } : { budgetId: value };
      const { ok, data } = await fetchJson<{ ok?: boolean }>("/api/select-budget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!ok) {
        setError(formatApiError(data));
        return;
      }
      await fetchStatus();
    } finally {
      setSelectBudgetLoading(false);
    }
  }

  async function onSelectBudgetForImport(value: string): Promise<void> {
    if (!value || value === status?.currentBudgetId) return;
    setPreview(null);
    setTransactions([]);
    setResult(null);
    dispatch({ type: "PATCH", patch: INITIAL_FORM_STATE });
    await onSelectBudget(value);
    void fetchAccounts();
  }

  async function onImport(): Promise<void> {
    setError(null);

    if (!preview) {
      setError(
        "Preview session is missing or expired.\n\nUpload and preview your file again, then run the import. Sessions expire after 30 minutes of inactivity.",
      );
      return;
    }

    try {
      const { ok, data } = await fetchJson<ImportApiResponse>("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: preview.sessionId,
          mapping: {
            date: form.mapping.date,
            amount: form.mapping.amount,
            inflow: form.mapping.inflow,
            outflow: form.mapping.outflow,
            inOut: form.mapping.inOut,
            payeeName: form.mapping.payee,
            notes: form.mapping.notes,
            importedId: form.mapping.importedId,
            account: form.mapping.account,
          },
          accountValueMap: form.accountValueMap,
          defaultAccountId: form.defaultAccountId || undefined,
          amountOptions: {
            splitMode: form.splitMode,
            inOutMode: form.inOutMode,
            outValue: form.outValue,
            flipAmount: form.flipAmount,
            multiplierAmount: form.multiplierAmount,
          },
          dryRun: form.dryRun,
          allowPartial: form.allowPartial,
        }),
      });
      if (!ok) {
        const parts = [data.error ?? "Import failed."];
        if (data.hint) parts.push(data.hint);
        if (data.rowErrors && data.rowErrors.length > 0) {
          parts.push(
            `Row errors: ${data.rowErrors
              .slice(0, 5)
              .map((e) => `row ${e.rowNumber}: ${e.message}`)
              .join("; ")}${data.rowErrors.length > 5 ? " …" : ""}`,
          );
        }
        setError(parts.join("\n\n"));
        return;
      }
      setResult(JSON.stringify(data, null, 2));
      if (status?.currentBudgetId && !form.dryRun) {
        savePreferences(status.currentBudgetId, form);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import transactions.";
      setError(
        `${message}\n\nCheck that the server is running and your Actual connection is configured correctly.`,
      );
    }
  }

  return (
    <main className="app-shell">
      <h1>Import Transactions from Multiple Accounts</h1>
      <p className="subtitle">
        Adapted from Actual’s Import Transactions modal flow, with additional account column
        mapping.
      </p>

      {error && (
        <section className="card error-banner" role="alert">
          <h3>Error</h3>
          <pre className="error-message">{error}</pre>
          <div className="error-actions">
            {status?.budgetLoaded && accounts.length === 0 && (
              <button type="button" onClick={() => void fetchAccounts()} aria-label="Retry loading">
                Retry
              </button>
            )}
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              Dismiss
            </button>
          </div>
        </section>
      )}

      {statusLoading ? (
        <section className="card">
          <p>Checking connection…</p>
        </section>
      ) : !status?.connected ? (
        <section className="card">
          <h2>Connect to Actual</h2>
          <p className="subtitle">
            Enter your Actual server URL and password (or session token) to connect.
          </p>
          <form onSubmit={(e) => void onConnect(e)}>
            <label>
              Server URL
              <input
                type="url"
                name="serverURL"
                placeholder="https://your-actual-server.com"
                required
              />
            </label>
            <label>
              Password
              <input type="password" name="password" placeholder="(optional if using token)" />
            </label>
            <label>
              Session token
              <input type="text" name="sessionToken" placeholder="(optional if using password)" />
            </label>
            <button type="submit" disabled={connectLoading}>
              {connectLoading ? "Connecting…" : "Connect"}
            </button>
          </form>
        </section>
      ) : !status.budgetLoaded ? (
        <section className="card">
          <h2>Select budget</h2>
          <p className="subtitle">Choose which Actual budget to use for this import session.</p>
          {status.budgets && status.budgets.length > 0 ? (
            <div className="grid">
              <label>
                Budget
                <select
                  id="setup-budget-select"
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) void onSelectBudget(value);
                  }}
                  disabled={selectBudgetLoading}
                >
                  <option value="">— Select a budget —</option>
                  {status.budgets.map((b) => {
                    const value = b.id ?? (b.syncId ? `sync:${b.syncId}` : "");
                    if (!value) return null;
                    const label = b.id ? b.name : `${b.name} (sync from server)`;
                    return (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
              {selectBudgetLoading && <p>Loading budget…</p>}
              {status.budgets.some((b) => !b.id && b.syncId) && (
                <p className="muted">Server-only budgets will be downloaded when selected.</p>
              )}
            </div>
          ) : (
            <p>
              No budgets found. Create a budget in Actual, or check the server URL and password.
            </p>
          )}
        </section>
      ) : null}

      {status?.budgetLoaded && (
        <>
          {status.budgets && status.budgets.length > 0 && (
            <section className="card">
              <h2>Budget</h2>
              <div className="grid">
                <label>
                  Active budget
                  <select
                    id="import-budget-select"
                    value={status.currentBudgetId ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) void onSelectBudgetForImport(value);
                    }}
                    disabled={selectBudgetLoading}
                  >
                    {status.budgets.map((b) => {
                      const value = b.id ?? (b.syncId ? `sync:${b.syncId}` : "");
                      if (!value) return null;
                      const label = b.id ? b.name : `${b.name} (sync from server)`;
                      return (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {selectBudgetLoading && <p>Switching budget…</p>}
              </div>
            </section>
          )}

          <ParseOptionsSection
            form={form}
            onSubmit={onPreview}
            onPatch={(patch) => dispatch({ type: "PATCH", patch })}
            fileResetTrigger={status?.currentBudgetId ?? undefined}
          />

          {preview && (
            <>
              <FieldMappings
                transactions={transactions}
                mappings={form.mapping}
                onChange={(field, newValue) =>
                  dispatch({
                    type: "SET_MAPPING_FIELD",
                    field,
                    value: newValue || null,
                  })
                }
                splitMode={form.splitMode}
                inOutMode={form.inOutMode}
                hasHeaderRow={form.hasHeaderRow}
              />

              <AmountOptionsSection
                form={form}
                onPatch={(patch) => dispatch({ type: "PATCH", patch })}
              />

              <AccountMappingSection
                form={form}
                accounts={accounts}
                uniqueAccountValues={preview.uniqueAccountValues}
                onPatch={(patch) => dispatch({ type: "PATCH", patch })}
                onAccountValueMapChange={(sourceValue, accountId) =>
                  dispatch({
                    type: "SET_ACCOUNT_VALUE_MAP",
                    sourceValue,
                    accountId,
                  })
                }
              />

              <PreviewSection preview={preview} previewRows={previewRows} />

              <ImportSection
                form={form}
                selectedCount={selectedCount}
                onPatch={(patch) => dispatch({ type: "PATCH", patch })}
                onImport={onImport}
                onSavePreferences={
                  status?.currentBudgetId
                    ? () => savePreferences(status.currentBudgetId!, form)
                    : undefined
                }
              />
            </>
          )}

          {result !== null && (
            <section className="card">
              <h2>Result</h2>
              <pre>{result}</pre>
            </section>
          )}
        </>
      )}
    </main>
  );
}
