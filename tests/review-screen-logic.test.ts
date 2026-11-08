import { describe, expect, it, vi } from "vitest";
import { blocksToText, api } from "@/components/review/ReviewScreen";
import type { NormalizedDocument } from "@/server/ingest/types";

describe("ReviewScreen helpers and logic", () => {
  it("blocksToText converts document blocks to newline-separated text", () => {
    const doc: NormalizedDocument = {
      version: 1,
      sourceKind: "text",
      title: "Doc",
      blocks: [
        { id: "b1", kind: "heading", text: "Heading Text" },
        { id: "b2", kind: "paragraph", text: "Paragraph text with fix applied." },
      ],
      images: [],
      stats: { chars: 42, blocks: 2, images: 0 },
    };

    expect(blocksToText(doc)).toBe("Heading Text\n\nParagraph text with fix applied.");
  });

  it("api() wraps fetch and handles HTML error bodies gracefully", async () => {
    // Mock fetch returning HTML error (e.g. 500 Internal Server Error)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("Unexpected token '<', <html>...")),
      text: () => Promise.resolve("<html>500 Server Error</html>"),
    } as unknown as Response);

    await expect(api("/test-url")).rejects.toThrow("Request failed (500)");

    // Mock fetch returning JSON with ok: false
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 400,
      json: () => Promise.resolve({ ok: false, error: { message: "Invalid payload" } }),
    } as unknown as Response);

    await expect(api("/test-url")).rejects.toThrow("Invalid payload");

    // Mock fetch returning successful JSON with ok: true
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, data: { count: 42 } }),
    } as unknown as Response);

    const res = await api<{ count: number }>("/test-url");
    expect(res).toEqual({ count: 42 });

    globalThis.fetch = originalFetch;
  });
});
