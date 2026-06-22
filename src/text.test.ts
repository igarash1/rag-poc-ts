import { describe, expect, it } from "vitest";
import { tokenize } from "./text.js"; // .js extension, even though it's .ts

describe("tokenize", () => {
  it("returns all content words, lowercased, stopwords removed", () => {
    expect(tokenize("When is the summer tournament?")).toEqual(["summer", "tournament"]);
  });

  it("keeps version strings and identifiers whole (for lexical matching)", () => {
    expect(tokenize("Does v2.3 fix the sdk-v4 e_42 bug?")).toEqual([
      "v2.3",
      "fix",
      "sdk-v4",
      "e_42",
      "bug",
    ]);
  });
});
