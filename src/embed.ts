/**
 * Embeddings. Real OpenAI when a key is present, deterministic mock otherwise.
 *
 * The mock is a hashed bag-of-words projected into EMBED_DIM and L2-normalized.
 * It is NOT semantic, but it shares the key property we need to demo retrieval
 * offline: texts that share vocabulary get higher cosine similarity. So the
 * golden eval is meaningful even without an API key.
 */

import * as config from "./config.js";
import { tokenize } from "./text.js";

function hash(s: string): number {
  const FNV_PRIME = 0x01000193; // 16777619
  let hash = 0x811c9dc5; // 2166136261 (Offset Basis)

  for (let i = 0; i < s.length; i++) {
    // Extract the character code point (handles basic ASCII/UTF-16 code units)
    const charCode = s.charCodeAt(i);

    // FNV-1a steps: XOR the lower 8 bits first, then multiply
    hash ^= charCode & 0xff;
    hash = Math.imul(hash, FNV_PRIME);

    // Optional: If you need to process the upper byte of 16-bit characters:
    // hash ^= (charCode >> 8) & 0xFF;
    // hash = Math.imul(hash, FNV_PRIME);
  }

  // Force the final return value to behave like an unsigned 32-bit integer
  return hash >>> 0;
}

// this is for testing
export function mockEmbed(text: string): number[] {
  const vec = new Array(config.EMBED_DIM).fill(0.0);
  for (const tok of tokenize(text)) {
    // Two independent hashes reduce collisions a little.
    vec[hash("h1:" + tok) % config.EMBED_DIM] += 1.0;
    vec[hash("h2:" + tok) % config.EMBED_DIM] += 1.0;
  }
  const norm = Math.hypot(...vec);
  if (norm === 0) {
    return vec;
  }
  return vec.map((v) => v / norm);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  /* Embed a batch of texts -> list of vectors (same order). */
  if (config.MOCK) {
    return texts.map(mockEmbed);
  }

  // Lazy imports so MOCK mode runs even without the provider SDKs installed.
  if (config.PROVIDER === "gemini") {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: config.GOOGLE_API_KEY });
    const resp = await client.models.embedContent({
      model: config.EMBED_MODEL,
      contents: texts,
    });
    if (!resp.embeddings) throw new Error("Gemini returned no embeddings");
    return resp.embeddings.map((e) => {
      if (!e.values) throw new Error("Gemini returned an embedding without values");
      return e.values;
    });
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  // OpenAI accepts a list input and returns embeddings in input order.
  const resp = await client.embeddings.create({
    model: config.EMBED_MODEL,
    input: texts,
  });
  return resp.data.map((d) => d.embedding);
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0]!;
}
