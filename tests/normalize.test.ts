import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocx } from "@/server/ingest/parse-docx";
import { parsePdf } from "@/server/ingest/parse-pdf";
import { parseText } from "@/server/ingest/parse-text";

const fixtures = path.resolve("tests/fixtures");

describe("normalizers", () => {
  it("splits pasted text into a heading and paragraphs and normalizes whitespace", () => {
    const doc = parseText(
      "Kettle & Co. Monsoon Blend\n\nOur BEST tea bags in India!!\n\nPackaging is 100% recyclable.",
      "copy.txt",
    );
    expect(doc.blocks).toHaveLength(3);
    expect(doc.blocks[0]).toMatchObject({
      kind: "heading",
      text: "Kettle & Co. Monsoon Blend",
    });
    expect(doc.blocks[1]?.text).toBe("Our BEST tea bags in India!!");
    expect(doc.title).toBe("Kettle & Co. Monsoon Blend");
    expect(doc.stats.blocks).toBe(3);
  });

  it("extracts text from a small PDF fixture", async () => {
    const buffer = await fs.readFile(path.join(fixtures, "sample.pdf"));
    const doc = await parsePdf(buffer, "sample.pdf");
    expect(doc.stats.noExtractableText).toBe(false);
    expect(doc.blocks.map((b) => b.text).join(" ")).toContain("Monsoon Blend");
    expect(doc.stats.pages).toBe(1);
  });

  it("flags a PDF with no extractable text", async () => {
    const buffer = await fs.readFile(path.join(fixtures, "empty.pdf"));
    const doc = await parsePdf(buffer, "empty.pdf");
    expect(doc.stats.noExtractableText).toBe(true);
    expect(doc.blocks).toHaveLength(0);
  });

  it("extracts DOCX paragraphs", async () => {
    const buffer = await fs.readFile(path.join(fixtures, "sample.docx"));
    const doc = await parseDocx(buffer, "sample.docx");
    const text = doc.blocks.map((b) => b.text).join(" ");
    expect(text).toContain("Monsoon Blend");
    expect(text).toContain("tea bags");
    expect(text).toContain("recyclable");
  });
});
