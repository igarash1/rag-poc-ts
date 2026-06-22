/**
 * Vector store.
 *
 * `VectorStore` is the interface; `InMemoryVectorStore` is a transparent
 * brute-force implementation (cosine over normalized rows). It is deliberately
 * tiny so you can see exactly what a vector DB does. In production this swaps 1:1
 * for pgvector (an `ivfflat`/`hnsw` index + `<=>` distance) or Chroma/Pinecone —
 * same `add` / `search(tenant, k)` contract, including the all-important tenant
 * filter.
 *
 * Python → TS notes:
 *   - `abc.ABC` + `@abstractmethod` → a plain `interface`; the implementation
 *     declares `implements VectorStore`.
 *   - There is no numpy. We hold rows as `number[][]` and write the linear
 *     algebra (L2 normalize, dot-product cosine, top-k) by hand. For a few dozen
 *     vectors this is plenty fast and totally transparent.
 *   - `np.savez` (binary) + JSON sidecar → one self-contained JSON via `node:fs`.
 *   - Renamed `NumpyVectorStore` → `InMemoryVectorStore`: the name should
 *     describe the behavior in *this* language, and there's no numpy here.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { INDEX_FILE } from "./config.js";
import type { Chunk, Retrieved } from "./types.js";

/** L2-normalize a vector so dot-products become cosine similarity. */
function l2normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec.slice();
  return vec.map((x) => x / norm);
}

/** Dot product. Both vectors must share the same dimension. */
function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `dot: dimension mismatch (${a.length} vs ${b.length}) — rebuild the index ` +
        `(rm rag-index.json) after switching embedding providers.`,
    );
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export interface VectorStore {
  add(chunks: Chunk[]): void;
  search(queryVec: number[], tenant: string, k: number): Retrieved[];
}

/** On-disk shape of the persisted index (TS owns this format). */
interface IndexFile {
  dim: number;
  chunks: Array<{
    id: string;
    tenant: string;
    channel: string;
    text: string;
    messageIds: string[];
    embedding: number[]; // L2-normalized
  }>;
}

export class InMemoryVectorStore implements VectorStore {
  private chunks: Chunk[] = [];
  private mat: number[][] = []; // N rows, each L2-normalized

  add(chunks: Chunk[]): void {
    for (const c of chunks) {
      if (!c.embedding) {
        throw new Error(`Chunk ${c.id} has no embedding — embed before add().`);
      }
      this.chunks.push(c);
      this.mat.push(l2normalize(c.embedding));
    }
  }

  search(queryVec: number[], tenant: string, k: number): Retrieved[] {
    if (this.mat.length === 0) return [];
    const q = l2normalize(queryVec);

    // Cosine, since rows + query are normalized. Tenant isolation: never score
    // chunks from another community (in pgvector this is `WHERE tenant = $1`).
    // We mask other tenants with -Infinity so they can never enter the top-k.
    const sims = this.mat.map((row, i) =>
      this.chunks[i]?.tenant === tenant ? dot(row, q) : -Infinity,
    );

    const eligible = sims.filter((s) => s !== -Infinity).length;
    const kk = Math.min(k, eligible);
    if (kk <= 0) return [];

    // numpy's argpartition+argsort, done plainly: pair each score with its index,
    // sort by score descending, take the first kk.
    return sims
      .map((score, i) => ({ score, i }))
      .sort((a, b) => b.score - a.score)
      .slice(0, kk)
      .map(({ score, i }) => ({ chunk: this.chunks[i]!, score }));
  }

  // --- persistence ---------------------------------------------------------
  save(path: string = INDEX_FILE): void {
    const payload: IndexFile = {
      dim: this.mat[0]?.length ?? 0,
      chunks: this.chunks.map((c, i) => ({
        id: c.id,
        tenant: c.tenant,
        channel: c.channel,
        text: c.text,
        messageIds: c.messageIds,
        embedding: this.mat[i]!,
      })),
    };
    writeFileSync(path, JSON.stringify(payload, null, 2), "utf-8");
  }

  static load(path: string = INDEX_FILE): InMemoryVectorStore {
    const store = new InMemoryVectorStore();
    const payload = JSON.parse(readFileSync(path, "utf-8")) as IndexFile;
    for (const m of payload.chunks) {
      if (m.embedding.length !== payload.dim) {
        throw new Error(
          `Corrupt index ${path}: embedding length ${m.embedding.length} ≠ declared dim ${payload.dim}. Re-run ingest.`,
        );
      }
      store.chunks.push({
        id: m.id,
        tenant: m.tenant,
        channel: m.channel,
        text: m.text,
        messageIds: m.messageIds,
        embedding: m.embedding,
      });
      store.mat.push(m.embedding); // already normalized at save time
    }
    return store;
  }

  static exists(path: string = INDEX_FILE): boolean {
    return existsSync(path);
  }
}
