/**
 * Compose a grounded, cited answer from retrieved chunks.
 *
 * Hallucination controls (interview talking points):
 *   1. Refuse when the best retrieval score is below a threshold -> "I don't know"
 *      instead of inventing an answer.
 *   2. Instruct the model to use ONLY the provided context and cite message IDs,
 *      so every claim is traceable back to a real message.
 */

import * as config from "./config.js";
import type { Retrieved, AnswerResult } from "./types.js";
import type { VectorStore } from "./store.js";
import { retrieve } from "./retrieve.js";
import { GoogleGenAI } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";

const SYSTEM =
  "You answer questions about a community's chat history. " +
  "Use ONLY the provided context. Cite the message IDs you relied on in " +
  "square brackets, e.g. [a3]. If the context does not contain the answer, " +
  "say you don't know — never guess.";

export function _format_context(hits: Retrieved[]): string {
  const blocks: string[] = [];
  for (const r of hits) {
    const ids = r.chunk.messageIds.join(", ");
    blocks.push(`[chunk ${r.chunk.id}] (messages: ${ids})\n${r.chunk.text}`);
  }
  return blocks.join("\n\n");
}

export function _mock_answer(question: string, hits: Retrieved[]): string {
  const top = hits[0]!;
  const ids = top.chunk.messageIds.join(", ");
  return (
    "(MOCK answer — no API key) Most relevant conversation " +
    `[${ids}] in #${top.chunk.channel}:\n${top.chunk.text}`
  );
}

export async function _llm_answer(question: string, hits: Retrieved[]): Promise<string> {
  const user = `Context:\n${_format_context(hits)}\n\nQuestion: ${question}`;

  if (config.PROVIDER == "gemini") {
    const client = new GoogleGenAI({ apiKey: config.GOOGLE_API_KEY });
    const resp = await client.models.generateContent({
      model: config.CHAT_MODEL,
      contents: user,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0,
      } as GenerateContentConfig,
    });
    return (resp.text || "").trim();
  }

  const OpenAI = (await import("openai")).default;

  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const resp = await client.chat.completions.create({
    model: config.CHAT_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    temperature: 0,
  });
  return resp.choices[0]!.message.content!.trim();
}

export async function answer(
  question: string,
  tenant: string,
  store: VectorStore,
): Promise<AnswerResult> {
  const hits = await retrieve(question, tenant, store, config.TOP_K);

  // Ground (and cite) only on chunks that individually clear the relevance bar —
  // the same threshold that drives refusal.
  const relevant = hits.filter((h) => h.score >= config.RETRIEVAL_MIN_SCORE);

  // [id, rounded score] pairs for the retrieval debug line (same in both paths).
  const retrieved = hits.map((r): [string, number] => [
    r.chunk.id,
    Number(r.score.toFixed(3)),
  ]);

  if (relevant.length === 0) {
    return {
      refused: true,
      answer: "I don't know based on this community's conversations.",
      citations: [],
      retrieved,
    };
  }

  const text = config.MOCK
    ? _mock_answer(question, relevant)
    : await _llm_answer(question, relevant);

  return {
    refused: false,
    answer: text,
    citations: relevant.map((r) => ({
      chunk: r.chunk.id,
      channel: r.chunk.channel,
      messages: r.chunk.messageIds,
    })),
    retrieved,
  };
}
