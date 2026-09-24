import { describe, it, expect } from "@jest/globals";
import { parseGitHubRepo } from "../src/utils/github.js";

describe("parseGitHubRepo", () => {
  it("parses a standard GitHub URL", () => {
    const result = parseGitHubRepo("https://github.com/facebook/react");
    expect(result).toEqual({ owner: "facebook", repo: "react" });
  });

  it("strips a trailing .git suffix", () => {
    const result = parseGitHubRepo("https://github.com/facebook/react.git");
    expect(result).toEqual({ owner: "facebook", repo: "react" });
  });

  it("returns null for a non-GitHub URL", () => {
    const result = parseGitHubRepo("https://gitlab.com/facebook/react");
    expect(result).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    const result = parseGitHubRepo("not a url");
    expect(result).toBeNull();
  });

  it("returns null when the path is missing a repo name", () => {
    const result = parseGitHubRepo("https://github.com/facebook");
    expect(result).toBeNull();
  });
});