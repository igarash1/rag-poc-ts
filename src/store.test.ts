/**
 * Tests for the vector store. This doubles as the *template* for verifying any
 * ported module: pin the behavior you care about (here: cosine ranking, tenant
 * isolation, top-k, round-trip persistence) so a future refactor can't silently
 * break it.
 *
 * Run:  npm test         (once)
 *       npm run test:watch
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryVectorStore } from "./store.js";
import type { Chunk } from "./types.js";

function chunk(id: string, tenant: string, embedding: number[]): Chunk {
  return { id, tenant, channel: "general", text: id, messageIds: [id], embedding };
}

describe("InMemoryVectorStore", () => {
  it("ranks by cosine similarity (most-aligned vector first)", () => {
    const store = new InMemoryVectorStore();
    store.add([
      chunk("a", "t1", [1, 0, 0]),
      chunk("b", "t1", [0, 1, 0]),
      chunk("c", "t1", [0.8, 0.2, 0]),
    ]);

    const hits = store.search([1, 0, 0], "t1", 3);

    expect(hits.map((h) => h.chunk.id)).toEqual(["a", "c", "b"]);
    expect(hits[0]!.score).toBeCloseTo(1, 5); // identical direction → cosine 1
    expect(hits[2]!.score).toBeCloseTo(0, 5); // orthogonal → cosine 0
  });

  it("normalizes magnitude (only direction matters)", () => {
    const store = new InMemoryVectorStore();
    store.add([chunk("a", "t1", [10, 0, 0])]); // big magnitude, same direction
    const [hit] = store.search([1, 0, 0], "t1", 1);
    expect(hit!.score).toBeCloseTo(1, 5);
  });

  it("enforces tenant isolation (never leaks another community's chunks)", () => {
    const store = new InMemoryVectorStore();
    store.add([
      chunk("a", "t1", [1, 0, 0]),
      chunk("secret", "t2", [1, 0, 0]), // perfect match but WRONG tenant
    ]);

    const hits = store.search([1, 0, 0], "t1", 5);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.chunk.id).toBe("a");
    expect(hits.some((h) => h.chunk.tenant === "t2")).toBe(false);
  });

  it("returns at most min(k, eligible) results", () => {
    const store = new InMemoryVectorStore();
    store.add([chunk("a", "t1", [1, 0, 0]), chunk("b", "t1", [0, 1, 0])]);
    expect(store.search([1, 0, 0], "t1", 5)).toHaveLength(2); // only 2 eligible
    expect(store.search([1, 0, 0], "t1", 1)).toHaveLength(1); // capped by k
    expect(store.search([1, 0, 0], "nobody", 5)).toHaveLength(0); // no tenant match
  });

  it("returns [] when empty", () => {
    expect(new InMemoryVectorStore().search([1, 0, 0], "t1", 3)).toEqual([]);
  });

  it("round-trips through save/load", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rag-store-"));
    const file = path.join(dir, "index.json");
    try {
      const store = new InMemoryVectorStore();
      store.add([chunk("a", "t1", [1, 0, 0]), chunk("b", "t1", [0, 1, 0])]);
      store.save(file);

      const loaded = InMemoryVectorStore.load(file);
      const hits = loaded.search([1, 0, 0], "t1", 2);
      expect(hits.map((h) => h.chunk.id)).toEqual(["a", "b"]);
      expect(hits[0]!.score).toBeCloseTo(1, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on a query/row dimension mismatch (stale cross-provider index)", () => {
    const store = new InMemoryVectorStore();
    store.add([chunk("a", "t1", [1, 0, 0])]); // 3-dim rows
    expect(() => store.search([1, 0], "t1", 1)).toThrow(/dimension mismatch/);
  });
});
