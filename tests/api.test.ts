import { afterEach, describe, expect, test } from "bun:test";

import { fetchJson, formatApiError } from "../web/src/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchJson", () => {
  test("returns parsed json payload on success", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, value: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await fetchJson<{ ok: boolean; value: number }>("/api/test");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true, value: 42 });
  });

  test("returns user-friendly error for non-json responses", async () => {
    globalThis.fetch = (async () =>
      new Response("server exploded", {
        status: 500,
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;

    const result = await fetchJson<{ ok: boolean }>("/api/test");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.data.error).toContain("server returned an error");
    expect(result.data.hint).toContain("server exploded");
  });

  test("returns parse error for invalid json", async () => {
    globalThis.fetch = (async () =>
      new Response("not valid json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await fetchJson<{ ok: boolean }>("/api/test");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(200);
    expect(result.data.error).toBe("The server response could not be read.");
    expect(result.data.hint).toContain("invalid JSON");
  });
});

describe("formatApiError", () => {
  test("formats error with hint", () => {
    expect(formatApiError({ error: "Bad request", hint: "Use a CSV file." })).toBe(
      "Bad request\n\nUse a CSV file.",
    );
  });

  test("falls back to default message", () => {
    expect(formatApiError({})).toBe("An error occurred.");
  });
});
