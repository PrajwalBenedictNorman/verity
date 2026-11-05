import { extractText } from "unpdf";
import type { Block, NormalizedDocument } from "./types";
import { splitParagraphs } from "./clean";

export async function parsePdf(
  buffer: Buffer,
  filename?: string,
): Promise<NormalizedDocument> {
  const { totalPages, text } = await extractText(new Uint8Array(buffer), {
    mergePages: false,
  });
  const pages = Array.isArray(text) ? text : [text];
  const blocks: Block[] = [];
  let n = 1;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const paras = splitParagraphs(pages[pageIndex] ?? "");
    for (const para of paras) {
      blocks.push({
        id: `b${n++}`,
        kind: "paragraph",
        text: para,
        page: pageIndex + 1,
      });
    }
  }
  const chars = blocks.reduce((sum, b) => sum + b.text.length, 0);
  const noExtractableText = chars < 20;
  return {
    version: 1,
    sourceKind: "pdf",
    title: filename?.replace(/\.[^.]+$/, "") ?? "PDF",
    blocks: noExtractableText ? [] : blocks,
    images: [],
    stats: {
      chars: noExtractableText ? 0 : chars,
      blocks: noExtractableText ? 0 : blocks.length,
      images: 0,
      pages: totalPages,
      noExtractableText,
    },
  };
}
