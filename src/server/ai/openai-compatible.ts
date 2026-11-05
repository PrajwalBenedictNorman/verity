import type { AiAdapter, AiCompleteResult, AiEmbedResult } from "./adapter";
import { EMBEDDING_DIM } from "@/lib/config";

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
      const body = {
        model,
        temperature: 0,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        response_format: { type: "json_object" },
      };
      const run = async (payload: typeof body) => {
        const res = await fetch(`${root}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(args.timeoutMs),
        });
        if (!res.ok) {
          throw new Error(`AI complete failed: ${res.status}`);
        }
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = json.choices?.[0]?.message?.content ?? "";
        return parseJson(content);
      };

      let parsed: unknown;
      try {
        parsed = await run(body);
      } catch (err) {
        throw err;
      }
      let checked = args.schema.safeParse(parsed);
      if (!checked.success) {
        parsed = await run({
          ...body,
          messages: [
            ...body.messages,
            {
              role: "user",
              content: "Return valid JSON only that matches the schema. No markdown.",
            },
          ],
        });
        checked = args.schema.safeParse(parsed);
        if (!checked.success) {
          throw new Error("AI JSON did not match schema");
        }
      }
      return {
        data: checked.data,
        provider,
        model,
        ms: Date.now() - started,
      };
    },

    async embed(texts: string[]): Promise<AiEmbedResult> {
      if (texts.length === 0) {
        return { vectors: [], provider, model: embeddingModel };
      }
      const res = await fetch(`${root}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: embeddingModel, input: texts }),
        signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 20_000)),
      });
      if (!res.ok) throw new Error(`AI embed failed: ${res.status}`);
      const json = (await res.json()) as {
        data?: { embedding: number[]; index: number }[];
      };
      const vectors = (json.data ?? [])
        .sort((a, b) => a.index - b.index)
        .map((d) => {
          const v = d.embedding;
          if (v.length !== EMBEDDING_DIM) {
            // pad/truncate so pgvector dimension stays stable
            const next = v.slice(0, EMBEDDING_DIM);
            while (next.length < EMBEDDING_DIM) next.push(0);
            return next;
          }
          return v;
        });
      return { vectors, provider, model: embeddingModel };
    },
  };
}
