import type { Block, NormalizedDocument } from "./types";
import { cleanBlockText } from "./clean";

export function parseText(raw: string, filename?: string): NormalizedDocument {
  const text = raw.replace(/\r\n/g, "\n");
  const chunks = text.split(/\n\s*\n/);
  const blocks: Block[] = [];
  let n = 1;

  for (let i = 0; i < chunks.length; i++) {
    const cleaned = cleanBlockText(chunks[i] ?? "");
    if (!cleaned) continue;
    const originalFirstLine = (chunks[i] ?? "").split("\n")[0]?.trim() ?? "";
    const isHeading =
      blocks.length === 0 &&
      originalFirstLine.length > 0 &&
      originalFirstLine.length < 80 &&
      chunks.length > 1 &&
      cleanBlockText(originalFirstLine) === cleaned;
    if (isHeading) {
      blocks.push({ id: `b${n++}`, kind: "heading", text: cleaned, level: 1 });
    } else {
      blocks.push({ id: `b${n++}`, kind: "paragraph", text: cleaned });
    }
  }

  const title =
    blocks.find((b) => b.kind === "heading")?.text ??
    filename?.replace(/\.[^.]+$/, "") ??
    blocks[0]?.text.slice(0, 80) ??
    "Untitled";

  return {
    version: 1,
    sourceKind: "text",
    title,
    blocks,
    images: [],
    stats: {
      chars: blocks.reduce((sum, b) => sum + b.text.length, 0),
      blocks: blocks.length,
      images: 0,
    },
  };
}
