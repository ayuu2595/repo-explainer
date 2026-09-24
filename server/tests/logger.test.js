import { describe, it, expect } from "@jest/globals";
import { estimateTokens } from "../src/utils/logger.js";

describe("estimateTokens", () => {
  it("estimates roughly 1 token per 4 characters", () => {
    const result = estimateTokens("a".repeat(400));
    expect(result).toBe(100);
  });

  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null or undefined input", () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });
});