/**
 * Centralized error handling: convert technical errors into human-readable,
 * actionable messages that help users resolve issues.
 */

export type UserFacingError = {
  message: string;
  hint?: string;
};

function extractMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (typeof o.msg === "string") return o.msg;
  }
  return String(err);
}

/**
 * Maps common error patterns to user-friendly messages with resolution hints.
 */
export function toUserFacingError(err: unknown): UserFacingError {
  const raw = extractMessage(err);
  const lower = raw.toLowerCase();

  // Connection / network
  if (
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("connect econnrefused")
  ) {
    return {
      message: "Cannot connect to the Actual server.",
      hint: "Check that ACTUAL_SERVER_URL is correct and the Actual server is running. If using a remote server, ensure it is reachable from this machine.",
    };
  }

  if (lower.includes("enotfound") || lower.includes("getaddrinfo") || lower.includes("dns")) {
    return {
      message: "Could not resolve the Actual server hostname.",
      hint: "Verify ACTUAL_SERVER_URL is correct and your network/DNS is working.",
    };
  }

  if (lower.includes("econnreset") || lower.includes("connection reset")) {
    return {
      message: "Connection to the Actual server was reset.",
      hint: "The server may have closed the connection. Check server logs, try again, or ensure the server is stable.",
    };
  }

  if (lower.includes("etimedout") || lower.includes("timeout")) {
    return {
      message: "Connection to the Actual server timed out.",
      hint: "The server may be slow or unreachable. Check ACTUAL_SERVER_URL and network connectivity.",
    };
  }

  // Auth
  if (
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("invalid password") ||
    lower.includes("invalid session")
  ) {
    return {
      message: "Authentication failed.",
      hint: "Provide a valid ACTUAL_PASSWORD or ACTUAL_SESSION_TOKEN. If using a session token, it may have expired.",
    };
  }

  if (lower.includes("forbidden") || lower.includes("403")) {
    return {
      message: "Access denied.",
      hint: "Your credentials do not have permission to access this budget.",
    };
  }

  // File / parse
  if (lower.includes("enoent") || lower.includes("no such file")) {
    return {
      message: "File not found.",
      hint: "Check that the file path is correct and the file exists.",
    };
  }

  if (lower.includes("eacces") || lower.includes("permission denied")) {
    return {
      message: "Permission denied accessing the file.",
      hint: "Ensure you have read permission for the file and write permission for the data directory.",
    };
  }

  if (
    lower.includes("unsupported") ||
    lower.includes("unknown format") ||
    lower.includes("format")
  ) {
    return {
      message: "Unsupported or unknown file format.",
      hint: "Use a file with extension .csv, .tsv, .qif, .ofx, .qfx, or .xml.",
    };
  }

  // Budget / Actual-specific
  if (lower.includes("budget") && lower.includes("not found")) {
    return {
      message: "Budget not found.",
      hint: "Check ACTUAL_BUDGET_ID or ACTUAL_BUDGET_NAME. Ensure the budget exists and you have access.",
    };
  }

  if (lower.includes("better-sqlite3") || lower.includes("sqlite")) {
    return {
      message: "Database error while accessing Actual data.",
      hint: "The data directory may be corrupted or in use by another process. Try closing other Actual instances.",
    };
  }

  // Fallback: use raw message but avoid exposing stack traces or internal paths
  const sanitized = raw.split("\n")[0] ?? raw;
  return { message: sanitized };
}

export function formatForUser(err: unknown): string {
  const { message, hint } = toUserFacingError(err);
  if (hint) {
    return `${message}\n\n${hint}`;
  }
  return message;
}
