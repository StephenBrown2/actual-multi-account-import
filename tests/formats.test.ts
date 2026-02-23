import { describe, expect, test } from "bun:test";

import { detectFormatFromPath } from "../src/import/formats";

describe("detectFormatFromPath", () => {
  test("detects known formats", () => {
    expect(detectFormatFromPath("/tmp/a.csv")).toBe("csv");
    expect(detectFormatFromPath("/tmp/a.tsv")).toBe("tsv");
    expect(detectFormatFromPath("/tmp/a.qif")).toBe("qif");
    expect(detectFormatFromPath("/tmp/a.ofx")).toBe("ofx");
    expect(detectFormatFromPath("/tmp/a.qfx")).toBe("qfx");
    expect(detectFormatFromPath("/tmp/a.xml")).toBe("xml");
  });

  test("returns unknown for unsupported paths", () => {
    expect(detectFormatFromPath("/tmp/a.json")).toBe("unknown");
    expect(detectFormatFromPath("/tmp/noext")).toBe("unknown");
  });
});
