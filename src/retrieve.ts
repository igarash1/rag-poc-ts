/**
 * Retrieval: embed the query, vector-search within the tenant, optionally
 * blend in a lexical (keyword-overlap) score to approximate hybrid search.
 *
 * Hybrid matters because pure embeddings miss exact tokens (error codes, version
 * strings like "v2.3", rare names). Lexical catches those; semantic catches
 * paraphrases. Production would use pgvector + Postgres full-text (or BM25) and
 * a re-ranker; here we keep a tiny, transparent stand-in.
 */

import { embedOne } from "./embed.js";
import type { VectorStore } from "./store.js";
import type { Retrieved } from "./types.js";
import { tokenize } from "./text.js";

function lexOverlap(query: string, text: string): number {
  const q = new Set(tokenize(query));
  if (q.size === 0) {
    return 0.0;
  }
  const d = new Set(tokenize(text));
  const intersection = new Set([...q].filter((x) => d.has(x)));
  return intersection.size / q.size; // fraction of query terms present
}

export async function retrieve(
  query: string,
  tenant: string,
  store: VectorStore,
  k: number,
  hybrid: boolean = true,
  alpha: number = 0.7,
): Promise<Retrieved[]> {
  /* Return top-k chunks for `tenant`. alpha weights semantic vs lexical. */
  // Over-fetch, then (optionally) re-rank by a blended score.
  const candidates = await store.search(await embedOne(query), tenant, Math.max(k, 10));
  if (!hybrid) {
    return candidates.slice(0, k);
  }

  const blended: Retrieved[] = [];
  for (const r of candidates) {
    const lex = lexOverlap(query, r.chunk.text);
    const score = alpha * r.score + (1 - alpha) * lex;
    blended.push({ chunk: r.chunk, score });
  }
  blended.sort((a, b) => b.score - a.score);
  return blended.slice(0, k);
}
