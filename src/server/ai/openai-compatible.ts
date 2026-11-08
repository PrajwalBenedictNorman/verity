import { z } from "zod";
import type { AiAdapter, AiCompleteResult, AiEmbedResult } from "./adapter";
import { EMBEDDING_DIM } from "@/lib/config";
import {
  AiError,
  classifyError,
  classifyHttpError,
  redact,
} from "./errors";
import { aiGuard } from "./guard";

function baseUrl() {
  return (process.env.AI_BASE_URL ?? "").replace(/\/$/, "");
}

async function parseJson(text: string) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const slice =
    start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(slice) as unknown;
}

export function formatZodIssues(error: z.ZodError, max = 10): string {
  return error.issues
    .slice(0, max)
    .map((issue) => {
      const p = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${p}: ${issue.message}`;
    })
    .join("\n");
}

export function createOpenAiCompatibleAdapter(): AiAdapter {
  const provider = "openai-compatible";
  const model = process.env.AI_MODEL ?? "";
  const embeddingModel = process.env.EMBEDDING_MODEL ?? "";
  const key = process.env.AI_API_KEY ?? "";
  const root = baseUrl();

  return {
    async complete(args): Promise<AiCompleteResult> {
      const started = Date.now();
      let callCount = 0;
      type ChatPayload = {
        model: string;
        temperature: number;
        messages: { role: string; content: string }[];
        response_format?: { type: "json_object" };
      };
      const body: ChatPayload = {
        model,
        temperature: 0,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        response_format: { type: "json_object" },
      };

      const send = async (
        payload: ChatPayload,
        allowJsonModeFallback = true,
      ): Promise<unknown> => {
        callCount++;
        const content = await aiGuard.run("chat", async () => {
          let res: Response;
          try {
            res = await fetch(`${root}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${key}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(args.timeoutMs),
            });
          } catch (fetchErr) {
            throw classifyError(fetchErr);
          }

          if (res.ok) {
            const json = (await res.json()) as {
              choices?: { message?: { content?: string } }[];
            };
            return {
              ok: true as const,
              content: json.choices?.[0]?.message?.content ?? "",
            };
          }

          const text = await res.text().catch(() => "");
          if (
            res.status === 400 &&
            allowJsonModeFallback &&
            payload.response_format
          ) {
            return { ok: false as const, status: 400, fallback: true as const };
          }

          throw classifyHttpError(res.status, text, res.headers);
        });

        if (!content.ok && content.fallback) {
          const rest = { ...payload };
          delete rest.response_format;
          return send(rest, false);
        }

        return parseJson(content.content);
      };

      let parsed: unknown = await send(body);
      let checked = args.schema.safeParse(parsed);
      if (!checked.success) {
        const formattedIssues = formatZodIssues(checked.error);
        const previousOutput = redact(JSON.stringify(parsed)).slice(0, 2000);
        parsed = await send({
          ...body,
          messages: [
            ...body.messages,
            {
              role: "user",
              content: `${formattedIssues}\n\nPrevious output: ${previousOutput}\n\nReturn valid JSON only, fixing these problems. No markdown.`,
            },
          ],
        });
        checked = args.schema.safeParse(parsed);
        if (!checked.success) {
          throw new AiError(
            "invalid_output",
            false,
            undefined,
            undefined,
            redact(formatZodIssues(checked.error)).slice(0, 500),
          );
        }
      }

      return {
        data: checked.data,
        provider,
        model,
        ms: Date.now() - started,
        calls: callCount,
      };
    },

    async embed(texts: string[]): Promise<AiEmbedResult> {
      if (texts.length === 0) {
        return { vectors: [], provider, model: embeddingModel, calls: 0 };
      }
      let callCount = 0;
      const sendEmbed = async (includeDimensions = true): Promise<number[][]> => {
        callCount++;
        const payload: Record<string, unknown> = {
          model: embeddingModel,
          input: texts,
        };
        if (includeDimensions && EMBEDDING_DIM) {
          payload.dimensions = EMBEDDING_DIM;
        }

        const result = await aiGuard.run("embed", async () => {
          let res: Response;
          try {
            res = await fetch(`${root}/embeddings`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${key}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 20_000)),
            });
          } catch (fetchErr) {
            throw classifyError(fetchErr);
          }

          if (res.ok) {
            const json = (await res.json()) as {
              data?: { embedding: number[]; index: number }[];
            };
            return { ok: true as const, data: json.data ?? [] };
          }

          const text = await res.text().catch(() => "");
          if (res.status === 400 && includeDimensions && EMBEDDING_DIM) {
            return { ok: false as const, status: 400, fallback: true as const };
          }
          throw classifyHttpError(res.status, text, res.headers);
        });

        if (!result.ok && result.fallback) {
          return sendEmbed(false);
        }

        const vectors = result.data
          .sort((a, b) => a.index - b.index)
          .map((d) => {
            const v = d.embedding;
            if (v.length !== EMBEDDING_DIM) {
              const next = v.slice(0, EMBEDDING_DIM);
              while (next.length < EMBEDDING_DIM) next.push(0);
              return next;
            }
            return v;
          });
        return vectors;
      };

      const vectors = await sendEmbed(Boolean(EMBEDDING_DIM));
      return { vectors, provider, model: embeddingModel, calls: callCount };
    },
  };
}

let cachedAdapter: AiAdapter | null = null;
let cachedKey = "";

export function getAdapter(): AiAdapter {
  const currentKey = `${process.env.AI_BASE_URL}|${process.env.AI_API_KEY}|${process.env.AI_MODEL}|${process.env.EMBEDDING_MODEL}|${process.env.EMBEDDING_DIM}|${process.env.AI_TIMEOUT_MS}`;
  if (!cachedAdapter || cachedKey !== currentKey) {
    cachedAdapter = createOpenAiCompatibleAdapter();
    cachedKey = currentKey;
  }
  return cachedAdapter;
}
