import React from "react";

type SelectFieldProps = {
  options: string[];
  value: null | string;
  onChange: (newValue: string) => void;
  hasHeaderRow: boolean;
  firstTransaction: Record<string, unknown>;
};

// Adapted from Actual's ImportTransactionsModal SelectField component.
export function SelectField({
  options,
  value,
  onChange,
  hasHeaderRow,
  firstTransaction,
}: SelectFieldProps): React.JSX.Element {
  const columns = options.map((option) => [
    option,
    hasHeaderRow
      ? option
      : `Column ${Number.parseInt(option, 10) + 1} (${String(firstTransaction[option])})`,
  ]);

  if (!columns.find((col) => col[0] === value)) {
    value = null;
  }

  return (
    <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose field...</option>
      {columns.map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}
