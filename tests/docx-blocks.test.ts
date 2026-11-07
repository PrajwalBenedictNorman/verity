import { describe, expect, it } from "vitest";
import { htmlToBlocks } from "@/server/ingest/parse-docx";
import type { ImageRef } from "@/server/ingest/types";

describe("DOCX HTML block mapping", () => {
  it("attaches images to the block that precedes them", () => {
    const images: ImageRef[] = [
      {
        id: "i1",
        storagePath: "ingest/one.png",
        mime: "image/png",
        width: 0,
        height: 0,
      },
    ];
    const blocks = htmlToBlocks(
      "<h1>Title</h1><p>Before</p><img src=\"ingest/one.png\" alt=\"Chart\" /><p>After</p>",
      images,
    );
    expect(blocks.map((b) => b.text)).toEqual(["Title", "Before", "After"]);
    expect(images[0]?.afterBlockId).toBe(blocks[1]?.id);
    expect(images[0]?.alt).toBe("Chart");
  });
});
