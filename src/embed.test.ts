/**
 * Tests for the MOCK embedder. Runs hermetically: vitest.config.ts forces
 * RAG_MOCK=1, so these never call a real provider (deterministic + free).
 *
 * What we pin: the MOCK embedder isn't semantic, but it must (a) be L2-normalized,
 * (b) be deterministic — the whole reason we use our own FNV hash instead of
 * Python's salted hash() — and (c) give shared vocabulary a higher cosine than
 * unrelated text. That's exactly what makes the offline golden eval meaningful.
 */
import { describe, expect, it } from "vitest";

import { EMBED_DIM } from "./config.js";
import { embedOne, embedTexts } from "./embed.js";

const dot = (a: number[], b: number[]): number =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
const norm = (a: number[]): number => Math.hypot(...a);

describe("mock embeddings", () => {
  it("produces an L2-normalized vector of EMBED_DIM", async () => {
    const v = await embedOne("when is the tournament");
    expect(v).toHaveLength(EMBED_DIM);
    expect(norm(v)).toBeCloseTo(1, 5);
  });

  it("is deterministic (unlike Python's per-process salted hash)", async () => {
    const a = await embedOne("dark mode shipped in v2.3");
    const b = await embedOne("dark mode shipped in v2.3");
    expect(a).toEqual(b);
  });

  it("gives shared vocabulary a higher cosine than unrelated text", async () => {
    const q = await embedOne("when is the tournament");
    const related = await embedOne("the summer tournament is on saturday");
    const unrelated = await embedOne("how do I enable streaming in the sdk");

    expect(dot(q, related)).toBeGreaterThan(0.3); // shares "tournament"
    expect(dot(q, unrelated)).toBeCloseTo(0, 5); // no shared content words
    expect(dot(q, related)).toBeGreaterThan(dot(q, unrelated));
  });

  it("batch-embeds in input order, matching embedOne per item", async () => {
    const texts = ["tournament saturday", "streaming sdk"];
    const batch = await embedTexts(texts);

    expect(batch).toHaveLength(2);
    expect(batch[0]).toEqual(await embedOne(texts[0]!));
    expect(batch[1]).toEqual(await embedOne(texts[1]!));
  });

  it("returns a zero vector for content-free text (no NaN from divide-by-zero)", async () => {
    const v = await embedOne("the is a of"); // all stopwords → no tokens
    expect(v).toHaveLength(EMBED_DIM);
    expect(norm(v)).toBe(0);
  });
});
