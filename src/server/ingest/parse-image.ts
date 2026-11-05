import sharp from "sharp";
import { saveStoredFile } from "@/server/storage";
import type { NormalizedDocument } from "./types";

export async function parseImage(
  buffer: Buffer,
  filename?: string,
): Promise<NormalizedDocument> {
  const meta = await sharp(buffer).metadata();
  const mime = meta.format ? `image/${meta.format}` : "application/octet-stream";
  const id = crypto.randomUUID();
  const ext = meta.format ?? "bin";
  const storagePath = await saveStoredFile(`ingest/${id}.${ext}`, buffer);
  return {
    version: 1,
    sourceKind: "image",
    title: filename?.replace(/\.[^.]+$/, "") ?? "Image",
    blocks: [],
    images: [
      {
        id: "i1",
        storagePath,
        mime,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      },
    ],
    stats: { chars: 0, blocks: 0, images: 1 },
  };
}
