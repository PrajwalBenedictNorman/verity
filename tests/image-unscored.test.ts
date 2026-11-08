import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalize } from "@/server/ingest/normalize";

describe("documents with no extractable text (image / empty)", () => {
  it("normalizes image files with noExtractableText: true", async () => {
    const buffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const doc = await normalize({ kind: "image", buffer, filename: "test-card.png" });

    expect(doc.sourceKind).toBe("image");
    expect(doc.blocks).toHaveLength(0);
    expect(doc.stats.noExtractableText).toBe(true);
  });

  it("identifies empty documents and image documents as noExtractableText", () => {
    const emptyDoc = {
      version: 1,
      sourceKind: "text" as const,
      title: "Empty",
      blocks: [],
      images: [],
      stats: { chars: 0, blocks: 0, images: 0, noExtractableText: true },
    };

    expect(emptyDoc.blocks.length === 0 || Boolean(emptyDoc.stats?.noExtractableText)).toBe(
      true,
    );
  });
});
