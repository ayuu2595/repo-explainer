import { describe, it, expect } from "@jest/globals";
import { reciprocalRankFusion } from "../src/utils/search.js";

describe("reciprocalRankFusion", () => {
  it("ranks an item found in both lists higher than one found in only one", () => {
    const vectorResults = [
      { source_path: "a.js", content: "alpha" },
      { source_path: "b.js", content: "beta" },
    ];
    const keywordResults = [
      { source_path: "a.js", content: "alpha" },
      { source_path: "c.js", content: "gamma" },
    ];

    const fused = reciprocalRankFusion(vectorResults, keywordResults);

    expect(fused[0].source_path).toBe("a.js");
  });

  it("returns an empty array when both inputs are empty", () => {
    const fused = reciprocalRankFusion([], []);
    expect(fused).toEqual([]);
  });

  it("deduplicates identical entries appearing in both lists", () => {
    const vectorResults = [{ source_path: "a.js", content: "alpha" }];
    const keywordResults = [{ source_path: "a.js", content: "alpha" }];

    const fused = reciprocalRankFusion(vectorResults, keywordResults);

    expect(fused.length).toBe(1);
  });
});