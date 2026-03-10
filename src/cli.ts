#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();

import { defaultCliDependencies, type CliDependencies } from "./cli/handlers";
import { buildProgram } from "./cli/program";

export {
  assertRequiredOptions,
  cliOptionsSchema,
  directoryArgumentSchema,
  fileArgumentSchema,
  normalizeCliOptions,
  parseAmountOptions,
  parseFieldMapping,
  parseFileOptions,
  parseKeyValue,
  validateCliOptions,
  withEnvFallback,
  type CliOptions,
  type ValidatedCliOptions,
} from "./cli/options";
export { buildProgram, type CliProgram } from "./cli/program";
export {
  defaultCliDependencies,
  executeImportCommand,
  executeWatchCommand,
  type CliDependencies,
} from "./cli/handlers";

export async function main(
  argv: string[] = process.argv,
  deps: CliDependencies = defaultCliDependencies,
) {
  const program = buildProgram(deps);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof z.ZodError) {
      deps.error(error.issues[0]?.message ?? error.message);
    } else {
      deps.error(deps.formatForUser(error));
    }
    process.exitCode = 1;
  } finally {
    await deps.closeActual();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
