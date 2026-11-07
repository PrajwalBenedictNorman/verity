import { z } from "zod";
import { AI_TIMEOUT_MS } from "@/lib/config";
import type { AiAdapter } from "@/server/ai/adapter";
import { AiError } from "@/server/ai/errors";
import type { NormalizedDocument } from "@/server/ingest/types";
import type { Finding } from "../types";
import { TONE_SYSTEM } from "./prompts";
import { withRetries } from "./retry";
import { createDeepStats, type DeepStats } from "./stats";

export const toneIssueSchema = z.object({
  blockId: z.string(),
  quote: z.string(),
  issue: z.string(),
  cited_source_code: z.string(),
  confidence: z.number().min(0).max(1).optional().transform((v) => v ?? 0.5),
  suggested_rewrite: z.string().nullish().transform((v) => v ?? null),
});

export const toneSchema = z.object({
  issues: z.array(z.unknown()),
});

function chunkText(doc: NormalizedDocument, size?: number) {
  const chunkSize = size ?? Number(process.env.AI_TONE_CHUNK_CHARS ?? 6000);
  const chunks: { text: string; blockIds: string[] }[] = [];
  let buf = "";
  let ids: string[] = [];
  for (const block of doc.blocks) {
    const next = `${block.id}: ${block.text}\n`;
    if (buf.length + next.length > chunkSize && buf.length > 0) {
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
  ctx?: DeepStats;
  deadline?: number;
}): Promise<{ findings: Finding[]; discarded: number; externalCalls: number }> {
  const ctx = args.ctx ?? createDeepStats();
  if (args.voiceSections.length === 0 || args.doc.blocks.length === 0) {
    return { findings: [], discarded: 0, externalCalls: ctx.calls };
  }
  const findings: Finding[] = [];
  let discarded = 0;
  for (const chunk of chunkText(args.doc)) {
    if (args.deadline && Date.now() > args.deadline) {
      throw new AiError(
        "timeout",
        false,
        undefined,
        undefined,
        "Deep review budget exceeded",
      );
    }

    const result = await withRetries(
      () =>
        args.adapter.complete({
          system: TONE_SYSTEM,
          user: JSON.stringify({
            voice_sections: args.voiceSections,
            blocks: chunk.text,
          }),
          schema: toneSchema,
          timeoutMs: AI_TIMEOUT_MS,
        }),
      { ctx },
    );
    if (result.calls > 1) {
      ctx.calls += result.calls - 1;
    }
    const data = toneSchema.parse(result.data);
    for (const raw of data.issues) {
      const parsed = toneIssueSchema.safeParse(raw);
      if (!parsed.success) {
        discarded += 1;
        continue;
      }
      const issue = parsed.data;
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
  return { findings, discarded, externalCalls: ctx.calls };
}
