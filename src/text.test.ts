import { describe, expect, it } from "vitest";
import { tokenize } from "./text.js"; // .js extension, even though it's .ts

describe("tokenize", () => {
  it("returns all content words, lowercased, stopwords removed", () => {
    expect(tokenize("When is the v2.3 tournament?")).toEqual(["v2", "3", "tournament"]);
  });
});
