import mammoth from "mammoth";
import { saveStoredFile } from "@/server/storage";
import { cleanBlockText } from "./clean";
import type { Block, ImageRef, NormalizedDocument } from "./types";

function stripTags(html: string) {
  return cleanBlockText(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1];
}

export function htmlToBlocks(html: string, images: ImageRef[]): Block[] {
  const blocks: Block[] = [];
  let n = 1;
  const re =
    /<(h[1-6]|p|li|td|th|img)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = (m[1] ?? "").toLowerCase();
    const attrs = m[2] ?? "";
    const inner = m[3] ?? "";
    if (tag === "img") {
      const src = attr(attrs, "src");
      const img = images.find((i) => i.storagePath === src || i.id === src);
      if (img) {
        img.afterBlockId = blocks.at(-1)?.id;
        img.alt = attr(attrs, "alt") ?? img.alt;
      }
      continue;
    }
    const text = stripTags(inner);
    if (!text) continue;
    const kind: Block["kind"] =
      tag.startsWith("h")
        ? "heading"
        : tag === "li"
          ? "list_item"
          : tag === "td" || tag === "th"
            ? "table_cell"
            : "paragraph";
    const block: Block = { id: `b${n++}`, kind, text };
    if (kind === "heading") {
      block.level = Number(tag.slice(1));
    }
    blocks.push(block);
  }
  return blocks;
}

export async function parseDocx(
  buffer: Buffer,
  filename?: string,
): Promise<NormalizedDocument> {
  const images: ImageRef[] = [];
  let imageN = 1;
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const data = await image.read();
        const id = `i${imageN++}`;
        const ext = (image.contentType.split("/")[1] ?? "bin").split("+")[0];
        const storagePath = await saveStoredFile(
          `ingest/${crypto.randomUUID()}.${ext}`,
          data,
        );
        images.push({
          id,
          storagePath,
          mime: image.contentType,
          width: 0,
          height: 0,
        });
        return { src: storagePath };
      }),
    },
  );

  const blocks = htmlToBlocks(result.value, images);
  const title =
    blocks.find((b) => b.kind === "heading")?.text ??
    filename?.replace(/\.[^.]+$/, "") ??
    "Document";

  return {
    version: 1,
    sourceKind: "docx",
    title,
    blocks,
    images,
    stats: {
      chars: blocks.reduce((sum, b) => sum + b.text.length, 0),
      blocks: blocks.length,
      images: images.length,
    },
  };
}
