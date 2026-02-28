export type SupportedImportFormat = "csv" | "tsv" | "qif" | "ofx" | "qfx" | "xml" | "unknown";

export type ParseFileOptions = {
  hasHeaderRow?: boolean;
  delimiter?: string;
  fallbackMissingPayeeToMemo?: boolean;
  skipStartLines?: number;
  skipEndLines?: number;
  importNotes?: boolean;
};

export type ParseError = {
  message: string;
  internal: string;
};

export type ParsedStructuredTransaction = {
  amount?: number | null;
  date?: string | null;
  payee_name?: string | null;
  imported_payee?: string | null;
  notes?: string | null;
  imported_id?: string | null;
  cleared?: boolean | null;
  account?: string | null;
};

export type ParsedDelimitedTransaction = Record<string, string> | string[];

export type ParsedTransaction = ParsedStructuredTransaction | ParsedDelimitedTransaction;

export type ParsedFileResult = {
  errors: ParseError[];
  transactions?: ParsedTransaction[];
};

export type NormalizedRow = {
  rowNumber: number;
  raw: Record<string, string>;
  structured: ParsedStructuredTransaction | null;
};

export type FieldMapping = {
  date?: string;
  amount?: string;
  inflow?: string;
  outflow?: string;
  inOut?: string;
  payeeName?: string;
  importedPayee?: string;
  notes?: string;
  importedId?: string;
  account?: string;
  cleared?: string;
};

export type AmountOptions = {
  splitMode?: boolean;
  inOutMode?: boolean;
  outValue?: string;
  flipAmount?: boolean;
  multiplierAmount?: string;
};

export type MappingRequest = {
  fieldMapping: FieldMapping;
  defaultAccountId?: string;
  accountValueMap?: Record<string, string>;
  amountOptions?: AmountOptions;
};

export type PreparedImportTransaction = {
  date: string;
  amount: number;
  payee_name?: string;
  imported_payee?: string;
  notes?: string;
  imported_id?: string;
  cleared?: boolean;
};

export type RowValidationError = {
  rowNumber: number;
  message: string;
};

export type MapRowsResult = {
  byAccountId: Map<string, PreparedImportTransaction[]>;
  rowErrors: RowValidationError[];
};

export type AccountRef = {
  id: string;
  name: string;
  closed?: boolean;
  offbudget?: boolean;
};

export type ConnectionOptions = {
  dataDir?: string;
  serverURL: string;
  password?: string;
  sessionToken?: string;
  budgetId?: string;
  budgetName?: string;
  syncId?: string;
};

export type PreviewPayload = {
  format: SupportedImportFormat;
  errors: ParseError[];
  columns: string[];
  inferredMapping: FieldMapping;
  uniqueAccountValues: string[];
  sampleRows: NormalizedRow[];
  totalRows: number;
};
