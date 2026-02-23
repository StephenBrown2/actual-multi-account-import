import type { SupportedImportFormat } from "../types";

const FORMAT_BY_EXTENSION: Record<string, SupportedImportFormat> = {
  ".csv": "csv",
  ".tsv": "tsv",
  ".qif": "qif",
  ".ofx": "ofx",
  ".qfx": "qfx",
  ".xml": "xml",
};

export function detectFormatFromPath(path: string): SupportedImportFormat {
  const lower = path.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex === -1) {
    return "unknown";
  }
  const ext = lower.slice(dotIndex);
  return FORMAT_BY_EXTENSION[ext] ?? "unknown";
}
