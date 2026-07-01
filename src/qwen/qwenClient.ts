import OpenAI from "openai";

import { DistilledFactCandidateSchema, MEMORY_EMBEDDING_DIM, type DistilledFactCandidate } from "../contracts.js";

export interface QwenClient {
  embed(input: string): Promise<number[]>;
  chat(input: { system: string; user: string }): Promise<string>;
  distill(input: { transcript: string }): Promise<DistilledFactCandidate[]>;
  adjudicate(input: { currentFact: string; candidateFact: string }): Promise<string>;
}

export function createQwenClient(): QwenClient {
  const client = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  });

  return {
    async embed(input) {
      const model = process.env.QWEN_EMBEDDING_MODEL ?? "text-embedding-v3";
      const response = await client.embeddings.create({ model, input });
      const embedding = response.data[0]?.embedding ?? [];

      if (embedding.length !== MEMORY_EMBEDDING_DIM) {
        throw new Error(`Embedding dimension mismatch: expected ${MEMORY_EMBEDDING_DIM}, got ${embedding.length}`);
      }

      return embedding;
    },
    async chat(input) {
      const model = process.env.QWEN_CHAT_MODEL ?? "qwen-plus";
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      });

      return response.choices[0]?.message?.content ?? "";
    },
    async distill(input) {
      const model = process.env.QWEN_CHAT_MODEL ?? "qwen-plus";
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract durable support-memory facts as JSON with a top-level facts array. Only use the approved predicate names.",
          },
          { role: "user", content: input.transcript },
        ],
      });

      const content = response.choices[0]?.message?.content ?? "{\"facts\":[]}";
      const parsed = JSON.parse(content) as { facts?: unknown[] };
      const candidates: DistilledFactCandidate[] = [];
      for (const fact of parsed.facts ?? []) {
        const result = DistilledFactCandidateSchema.safeParse(fact);
        if (result.success) {
          candidates.push(result.data);
        } else {
          console.warn(
            "[qwenClient.distill] dropping candidate that failed schema validation:",
            result.error.issues.map((issue) => issue.message).join("; ")
          );
        }
      }
      return candidates;
    },
    async adjudicate(input) {
      return this.chat({
        system: "Return one line explaining whether the new fact supersedes the old fact, should be merged, or should be rejected.",
        user: `Current fact: ${input.currentFact}\nCandidate fact: ${input.candidateFact}`,
      });
    },
  };
}
