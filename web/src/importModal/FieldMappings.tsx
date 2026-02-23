import React from "react";

import { SelectField } from "./SelectField";
import { stripCsvImportTransaction } from "./utils";
import type { FieldMapping, ImportTransaction } from "./utils";

type FieldMappingsProps = {
  transactions: ImportTransaction[];
  mappings: FieldMapping;
  onChange: (field: keyof FieldMapping, newValue: string) => void;
  splitMode: boolean;
  inOutMode: boolean;
  hasHeaderRow: boolean;
};

type MappingFieldProps = {
  title: string;
  field: keyof FieldMapping;
  options: string[];
  mappings: FieldMapping;
  hasHeaderRow: boolean;
  firstTransaction: ImportTransaction;
  onChange: (field: keyof FieldMapping, newValue: string) => void;
};

function MappingField({
  title,
  field,
  options,
  mappings,
  hasHeaderRow,
  firstTransaction,
  onChange,
}: MappingFieldProps): React.JSX.Element {
  return (
    <label>
      {title}
      <SelectField
        options={options}
        value={mappings[field]}
        onChange={(newValue) => onChange(field, newValue)}
        hasHeaderRow={hasHeaderRow}
        firstTransaction={firstTransaction}
      />
    </label>
  );
}

// Adapted from Actual's ImportTransactionsModal FieldMappings component.
export function FieldMappings({
  transactions,
  mappings,
  onChange,
  splitMode,
  inOutMode,
  hasHeaderRow,
}: FieldMappingsProps): React.JSX.Element | null {
  if (transactions.length === 0) {
    return null;
  }

  const firstTransaction = transactions[0]!;
  const trans = stripCsvImportTransaction(firstTransaction);
  const options = Object.keys(trans);

  return (
    <section className="card">
      <h3>CSV FIELDS</h3>
      <div className="mapping-grid">
        <MappingField
          title="Date"
          field="date"
          options={options}
          mappings={mappings}
          hasHeaderRow={hasHeaderRow}
          firstTransaction={firstTransaction}
          onChange={onChange}
        />
        <MappingField
          title="Payee"
          field="payee"
          options={options}
          mappings={mappings}
          hasHeaderRow={hasHeaderRow}
          firstTransaction={firstTransaction}
          onChange={onChange}
        />
        <MappingField
          title="Notes"
          field="notes"
          options={options}
          mappings={mappings}
          hasHeaderRow={hasHeaderRow}
          firstTransaction={firstTransaction}
          onChange={onChange}
        />
        <MappingField
          title="Category"
          field="category"
          options={options}
          mappings={mappings}
          hasHeaderRow={hasHeaderRow}
          firstTransaction={firstTransaction}
          onChange={onChange}
        />
        <MappingField
          title="Account"
          field="account"
          options={options}
          mappings={mappings}
          hasHeaderRow={hasHeaderRow}
          firstTransaction={firstTransaction}
          onChange={onChange}
        />
        <MappingField
          title="Imported ID"
          field="importedId"
          options={options}
          mappings={mappings}
          hasHeaderRow={hasHeaderRow}
          firstTransaction={firstTransaction}
          onChange={onChange}
        />
        {splitMode && !inOutMode ? (
          <>
            <MappingField
              title="Outflow"
              field="outflow"
              options={options}
              mappings={mappings}
              hasHeaderRow={hasHeaderRow}
              firstTransaction={firstTransaction}
              onChange={onChange}
            />
            <MappingField
              title="Inflow"
              field="inflow"
              options={options}
              mappings={mappings}
              hasHeaderRow={hasHeaderRow}
              firstTransaction={firstTransaction}
              onChange={onChange}
            />
          </>
        ) : (
          <>
            {inOutMode && (
              <MappingField
                title="In/Out"
                field="inOut"
                options={options}
                mappings={mappings}
                hasHeaderRow={hasHeaderRow}
                firstTransaction={firstTransaction}
                onChange={onChange}
              />
            )}
            <MappingField
              title="Amount"
              field="amount"
              options={options}
              mappings={mappings}
              hasHeaderRow={hasHeaderRow}
              firstTransaction={firstTransaction}
              onChange={onChange}
            />
          </>
        )}
      </div>
    </section>
  );
}
