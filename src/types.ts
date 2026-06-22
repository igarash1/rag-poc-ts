/**
 * Core data types. Kept deliberately small and explicit.
 *
 * Python → TS notes:
 *   - `@dataclass` becomes a plain `interface`. For immutable value objects you
 *     rarely need a class in TS — an interface gives you structural typing and
 *     zero runtime cost.
 *   - Python `str | None` → TS `string | null`. Under `strict`, the compiler now
 *     forces you to handle the null case wherever you read it.
 *   - We use camelCase fields (`replyTo`, `messageIds`) — the idiomatic TS
 *     convention. The on-disk JSON uses snake_case (`reply_to`), so the JSON is
 *     mapped to these types at the I/O boundary (see segment.ts / eval.ts).
 */

export interface Message {
  id: string;
  tenant: string;
  channel: string;
  author: string;
  ts: string;
  content: string;
  replyTo: string | null;
}

/**
 * A retrievable unit: one conversation segment (several messages).
 *
 * Why segment-level and not message-level? A single chat message ("+1") is
 * meaningless out of context. Grouping a thread/time-window keeps the question +
 * answer together, which is what makes conversation RAG work.
 */
export interface Chunk {
  id: string;
  tenant: string;
  channel: string;
  /** rendered "Author (ts): content" lines, fed to the LLM */
  text: string;
  messageIds: string[];
  /** set after embedding; absent until then (Python's `embedding: ... = None`) */
  embedding?: number[];
}

export interface Retrieved {
  chunk: Chunk;
  /** cosine similarity in [-1, 1] */
  score: number;
}

export interface AnswerResult {
  refused: boolean;
  answer: string;
  citations: { chunk: string; channel: string; messages: string[] }[];
  retrieved: [string, number][];
}
