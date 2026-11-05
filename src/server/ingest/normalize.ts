import { MAX_INPUT_BYTES, MAX_INPUT_CHARS } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { parseDocx } from "./parse-docx";
import { parseImage } from "./parse-image";
import { parsePdf } from "./parse-pdf";
import { parseText } from "./parse-text";
import type { NormalizedDocument } from "./types";

export type NormalizeInput = {
  kind: NormalizedDocument["sourceKind"];
  buffer?: Buffer;
  text?: string;
  filename?: string;
};

export async function normalize(input: NormalizeInput): Promise<NormalizedDocument> {
  if (input.buffer && input.buffer.byteLength > MAX_INPUT_BYTES) {
    throw new AppError(
      "too_large",
      "File is larger than 10 MB.",
      413,
    );
  }
  if (input.text && Buffer.byteLength(input.text, "utf8") > MAX_INPUT_BYTES) {
    throw new AppError("too_large", "Text is larger than 10 MB.", 413);
  }

  let doc: NormalizedDocument;
  switch (input.kind) {
    case "text":
      if (input.text === undefined) {
        throw new AppError("bad_request", "Text is required.");
      }
      doc = parseText(input.text, input.filename);
      break;
    case "pdf":
      if (!input.buffer) throw new AppError("bad_request", "PDF buffer is required.");
      doc = await parsePdf(input.buffer, input.filename);
      break;
    case "docx":
      if (!input.buffer) throw new AppError("bad_request", "DOCX buffer is required.");
      doc = await parseDocx(input.buffer, input.filename);
      break;
    case "image":
      if (!input.buffer) throw new AppError("bad_request", "Image buffer is required.");
      doc = await parseImage(input.buffer, input.filename);
      break;
    default: {
      const _never: never = input.kind;
      throw new AppError("bad_request", `Unsupported kind: ${_never}`);
    }
  }

  if (doc.stats.chars > MAX_INPUT_CHARS) {
    throw new AppError(
      "too_large",
      "Document has more than 100,000 characters.",
      413,
    );
  }
  return doc;
}

export function kindFromFilename(
  filename: string,
  mime?: string,
): NormalizedDocument["sourceKind"] | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (
    lower.endsWith(".docx") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    /\.(png|jpe?g|gif|webp|tif{1,2})$/.test(lower) ||
    (mime?.startsWith("image/") ?? false)
  ) {
    return "image";
  }
  if (lower.endsWith(".txt") || mime === "text/plain") return "text";
  return null;
}
