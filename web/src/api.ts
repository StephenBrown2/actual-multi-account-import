/**
 * Safe API helpers that handle network errors, non-JSON responses,
 * and surface human-readable error messages.
 */

export type ApiErrorPayload = { error?: string; hint?: string };

export async function fetchJson<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: boolean; data: T & ApiErrorPayload; status: number }> {
  const response = await fetch(url, options);
  let data: T & ApiErrorPayload;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    return {
      ok: false,
      status: response.status,
      data: {
        error:
          response.status >= 500
            ? "The server returned an error. It may be down or misconfigured."
            : "The server returned an unexpected response.",
        hint: text.slice(0, 200) || "Check the server logs for details.",
      } as T & ApiErrorPayload,
    };
  }

  try {
    data = (await response.json()) as T & ApiErrorPayload;
  } catch (err) {
    return {
      ok: false,
      status: response.status,
      data: {
        error: "The server response could not be read.",
        hint:
          err instanceof SyntaxError
            ? "The server may have returned invalid JSON. Check that the API is working correctly."
            : err instanceof Error
              ? err.message
              : "Unknown error while parsing the response.",
      } as T & ApiErrorPayload,
    };
  }

  return { ok: response.ok, data, status: response.status };
}

export function formatApiError(payload: ApiErrorPayload): string {
  if (payload.hint) {
    return `${payload.error ?? "An error occurred."}\n\n${payload.hint}`;
  }
  return payload.error ?? "An error occurred.";
}
