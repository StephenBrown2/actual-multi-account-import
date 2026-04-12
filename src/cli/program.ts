import { cac } from "cac";
import type { CAC, Command as CacCommand } from "cac";

import { defaultCliDependencies, executeWatchCommand, type CliDependencies } from "./handlers";
import {
  directoryArgumentSchema,
  fileArgumentSchema,
  normalizeCliOptions,
  validateCliOptions,
} from "./options";

export type CliProgram = {
  cli: CAC;
  parseAsync: (argv?: string[]) => Promise<void>;
};

function addCommonOptions(command: CacCommand): CacCommand {
  return command
    .option("--server-url <url>", "Actual server URL")
    .option("--password <password>", "Actual server password")
    .option("--session-token <token>", "Actual API session token")
    .option("--data-dir <path>", "Directory to store local Actual state")
    .option("--budget-id <id>", "Budget ID to load")
    .option("--budget-name <name>", "Budget name to load")
    .option("--sync-id <id>", "Sync ID (downloads budget if needed)")
    .option("--default-account <name-or-id>", "Fallback account when account column is absent")
    .option("--account-column <column>", "Column containing account names/ids")
    .option("--map-account <from=to>", "Map account column value to Actual account id/name", {
      type: [String],
    })
    .option(
      "--map-field <field=column>",
      "Map fields for delimited files (date,amount,inflow,outflow,inOut,payee,notes,importedId,account,cleared)",
      { type: [String] },
    )
    .option("--has-header", "Delimited file has a header row", { default: true })
    .option("--no-has-header", "Delimited file has no header row")
    .option("--delimiter <char>", "CSV/TSV delimiter override")
    .option("--skip-start-lines <n>", "Skip first N lines")
    .option("--skip-end-lines <n>", "Skip last N lines")
    .option("--import-notes", "Import note/memo values where supported", { default: true })
    .option("--no-import-notes", "Do not import note/memo values")
    .option("--fallback-missing-payee-to-memo", "OFX/QFX: use memo when payee is missing")
    .option("--dry-run", "Preview import only; do not write transactions")
    .option("--allow-partial", "Import valid rows even if some rows fail validation")
    .option("--json", "Emit machine-readable JSON output")
    .option("--in-out-mode", "Use in/out column to determine inflow vs outflow")
    .option("--out-value <string>", "Value in in/out column that means outflow (e.g. debit)")
    .option("--split-mode", "Use separate inflow and outflow columns")
    .option("--flip-amount", "Negate amounts (inflow↔outflow)")
    .option("--multiplier-amount <n>", "Multiply amounts by this factor", { default: "1" })
    .option("--before <YYYY-MM-DD>", "Exclude transactions after this date")
    .option("--after <YYYY-MM-DD>", "Exclude transactions before this date");
}

export function buildProgram(deps: CliDependencies = defaultCliDependencies): CliProgram {
  const cli = cac("actual-multi-account-import");

  cli.help();
  cli.version("0.1.0");

  addCommonOptions(
    cli.command(
      "import <file>",
      "Import one file into Actual with optional per-row account mapping",
    ),
  )
    .usage("import <file> [options]")
    .example(
      (bin) =>
        `${bin} import ./transactions.csv --server-url http://localhost:5006 --password secret --budget-name Personal --default-account Checking`,
    )
    .example(
      (bin) =>
        `${bin} import ./transactions.csv --server-url http://localhost:5006 --password secret --budget-name Personal --account-column Account --map-account "Business Checking=acct_business_id" --map-field "date=Date" --map-field "amount=Amount" --map-field "payee=Description"`,
    )
    .example(
      (bin) =>
        `${bin} import ./transactions.csv --budget-name Personal --session-token token --map-field "date=Date" --map-field "amount=Amount" --map-field "payee=Description"`,
    )
    .action(async (file: string | undefined, rawOptions: Record<string, unknown>) => {
      const options = validateCliOptions(normalizeCliOptions(rawOptions));
      const validatedFile = fileArgumentSchema.parse(file);
      await deps.executeImportCommand(validatedFile, options);
    });

  addCommonOptions(
    cli.command(
      "watch <directory>",
      "Watch a directory and auto-import CSV/TSV/QIF/OFX/QFX/XML files when they appear",
    ),
  )
    .usage("watch <directory> [options]")
    .example(
      (bin) =>
        `${bin} watch ./imports --server-url http://localhost:5006 --password secret --budget-name Personal --default-account Checking --map-field "date=Date" --map-field "amount=Amount" --map-field "payee=Description"`,
    )
    .example(
      (bin) =>
        `${bin} watch ./imports --budget-name Personal --session-token token --account-column Account --map-account "Checking=acct_checking" --map-field "date=Date" --map-field "amount=Amount" --map-field "payee=Description"`,
    )
    .action(async (directory: string, rawOptions: Record<string, unknown>) => {
      const options = validateCliOptions(normalizeCliOptions(rawOptions));
      const validatedDirectory = directoryArgumentSchema.parse(directory);
      await executeWatchCommand(validatedDirectory, options, deps);
    });

  return {
    cli,
    parseAsync: async (argv: string[] = process.argv) => {
      cli.parse(argv, { run: false });
      await Promise.resolve(cli.runMatchedCommand());
    },
  };
}
