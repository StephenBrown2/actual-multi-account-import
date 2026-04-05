import { describe, expect, test } from "bun:test";

import { formatForUser, toUserFacingError } from "../src/errors";

describe("toUserFacingError", () => {
  test("maps connection refused errors", () => {
    expect(toUserFacingError(new Error("connect ECONNREFUSED 127.0.0.1:5006"))).toEqual({
      message: "Cannot connect to the Actual server.",
      hint: expect.stringContaining("ACTUAL_SERVER_URL"),
    });
  });

  test("maps authentication errors", () => {
    expect(toUserFacingError(new Error("401 unauthorized"))).toEqual({
      message: "Authentication failed.",
      hint: expect.stringContaining("ACTUAL_PASSWORD"),
    });
  });

  test("maps unsupported format errors", () => {
    expect(toUserFacingError(new Error("Unsupported file format"))).toEqual({
      message: "Unsupported or unknown file format.",
      hint: expect.stringContaining(".csv"),
    });
  });

  test("falls back to sanitized first line of raw error", () => {
    expect(toUserFacingError(new Error("first line\nstack trace"))).toEqual({
      message: "first line",
    });
  });
});

describe("formatForUser", () => {
  test("combines message and hint", () => {
    expect(formatForUser(new Error("permission denied"))).toContain(
      "Permission denied accessing the file.",
    );
    expect(formatForUser(new Error("permission denied"))).toContain("read permission");
  });

  test("includes debug location when ACTUAL_IMPORT_DEBUG is enabled", () => {
    const previous = process.env.ACTUAL_IMPORT_DEBUG;
    process.env.ACTUAL_IMPORT_DEBUG = "true";

    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at parseFileWithActual (/workspace/src/actual/client.ts:390:15)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n");

    const formatted = formatForUser(error);

    expect(formatted).toContain("boom");
    expect(formatted).toContain(
      "Debug location: parseFileWithActual (/workspace/src/actual/client.ts:390:15)",
    );

    if (previous === undefined) {
      delete process.env.ACTUAL_IMPORT_DEBUG;
    } else {
      process.env.ACTUAL_IMPORT_DEBUG = previous;
    }
  });
});
