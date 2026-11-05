import { z } from "zod";
import { AI_TIMEOUT_MS } from "@/lib/config";
import type { AiAdapter } from "@/server/ai/adapter";
import type { NormalizedDocument } from "@/server/ingest/types";
import type { Finding } from "../types";
import { TONE_SYSTEM } from "./prompts";

export const toneSchema = z.object({
  issues: z.array(
    z.object({
      blockId: z.string(),
      quote: z.string(),
      issue: z.string(),
      cited_source_code: z.string(),
      confidence: z.number().min(0).max(1),
      suggested_rewrite: z.string().nullable(),
    }),
  ),
});

function chunkText(doc: NormalizedDocument, size = 1500) {
  const chunks: { text: string; blockIds: string[] }[] = [];
  let buf = "";
  let ids: string[] = [];
  for (const block of doc.blocks) {
    const next = `${block.id}: ${block.text}\n`;
    if (buf.length + next.length > size && buf.length > 0) {
      chunks.push({ text: buf, blockIds: ids });
      buf = "";
      ids = [];
    }
    buf += next;
    ids.push(block.id);
  }
  if (buf) chunks.push({ text: buf, blockIds: ids });
  return chunks;
}

export async function analyseTone(args: {
  doc: NormalizedDocument;
  voiceSections: { code: string; body: string }[];
  adapter: AiAdapter;
}): Promise<{ findings: Finding[]; discarded: number; externalCalls: number }> {
  if (args.voiceSections.length === 0 || args.doc.blocks.length === 0) {
    return { findings: [], discarded: 0, externalCalls: 0 };
  }
  const findings: Finding[] = [];
  let discarded = 0;
  let externalCalls = 0;
  for (const chunk of chunkText(args.doc)) {
    const result = await args.adapter.complete({
      system: TONE_SYSTEM,
      user: JSON.stringify({
        voice_sections: args.voiceSections,
        blocks: chunk.text,
      }),
      schema: toneSchema,
      timeoutMs: AI_TIMEOUT_MS,
    });
    externalCalls += 1;
    const data = toneSchema.parse(result.data);
    for (const issue of data.issues) {
      const block = args.doc.blocks.find((b) => b.id === issue.blockId);
      if (!block) {
        discarded += 1;
        continue;
      }
      const start = block.text.indexOf(issue.quote);
      if (start === -1) {
        discarded += 1;
        continue;
      }
      const section = args.voiceSections.find((s) => s.code === issue.cited_source_code);
      findings.push({
        id: crypto.randomUUID(),
        tier: "deep",
        kind: "Tone",
        severity: "warn",
        confidence: issue.confidence,
        blockId: block.id,
        start,
        end: start + issue.quote.length,
        matchedText: issue.quote,
        message: issue.issue,
        source: {
          type: "guideline",
          code: issue.cited_source_code,
          snapshot: section?.body ?? issue.issue,
        },
        suggestion: issue.suggested_rewrite,
        state: "open",
      });
    }
  }
  return { findings, discarded, externalCalls };
}
