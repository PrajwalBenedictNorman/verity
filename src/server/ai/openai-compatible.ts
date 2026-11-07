import type { AiAdapter, AiCompleteResult, AiEmbedResult } from "./adapter";
import { EMBEDDING_DIM } from "@/lib/config";
import {
  AiError,
  classifyError,
  classifyHttpError,
  redact,
} from "./errors";

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
          const content = json.choices?.[0]?.message?.content ?? "";
          return parseJson(content);
        }

        const text = await res.text().catch(() => "");
        if (
          res.status === 400 &&
          allowJsonModeFallback &&
          payload.response_format
        ) {
          const rest = { ...payload };
          delete rest.response_format;
          return send(rest, false);
        }

        throw classifyHttpError(res.status, text, res.headers);
      };

      let parsed: unknown = await send(body);
      let checked = args.schema.safeParse(parsed);
      if (!checked.success) {
        const invalidOutputStr = redact(
          typeof parsed === "string" ? parsed : JSON.stringify(parsed),
        ).slice(0, 1000);
        parsed = await send({
          ...body,
          messages: [
            ...body.messages,
            {
              role: "user",
              content: `The previous response did not match the schema: ${checked.error.message}. Previous output: ${invalidOutputStr}. Return valid JSON only that strictly matches the schema. No markdown.`,
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
            redact(
              typeof parsed === "string" ? parsed : JSON.stringify(parsed),
            ).slice(0, 500),
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

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (res.status === 400 && includeDimensions && EMBEDDING_DIM) {
            return sendEmbed(false);
          }
          throw classifyHttpError(res.status, text, res.headers);
        }

        const json = (await res.json()) as {
          data?: { embedding: number[]; index: number }[];
        };
        const vectors = (json.data ?? [])
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
