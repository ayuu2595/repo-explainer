import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { encrypt } from "../src/utils/crypto.js";

process.env.JWT_SECRET = "test-secret";
process.env.ENCRYPTION_KEY = "0".repeat(64);

jest.unstable_mockModule("../src/config/db.js", () => ({
  pool: { query: jest.fn() },
}));

jest.unstable_mockModule("../src/utils/github.js", () => ({
  parseGitHubRepo: jest.fn(() => ({ owner: "facebook", repo: "react" })),
  verifyRepoAccess: jest.fn(() => ({ defaultBranch: "main" })),
  getEligibleFiles: jest.fn(() => []),
  fetchFileContent: jest.fn(() => null),
  getLatestCommitSha: jest.fn(() => "abc123"),
  getChangedFiles: jest.fn(() => []),
}));

jest.unstable_mockModule("../src/utils/embeddings.js", () => ({
  embedTexts: jest.fn(() => []),
  embedText: jest.fn(() => new Array(1536).fill(0)),
  toVectorLiteral: jest.fn(() => "[0]"),
  generateChatCompletion: jest.fn(() => '{"summary":"test","techStack":[],"patterns":[]}'),
}));

const { pool } = await import("../src/config/db.js");
const reposRouter = (await import("../src/routes/repos.js")).default;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/repos", reposRouter);

function authCookie(userId) {
  const token = jwt.sign({ userId }, "test-secret");
  return `token=${token}`;
}

describe("POST /api/repos/estimate", () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it("rejects an invalid GitHub URL", async () => {
    const githubUtils = await import("../src/utils/github.js");
    githubUtils.parseGitHubRepo.mockReturnValueOnce(null);

    const res = await request(app)
      .post("/api/repos/estimate")
      .set("Cookie", authCookie(1))
      .send({ repoUrl: "not-a-url" });

    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/repos/estimate")
      .send({ repoUrl: "https://github.com/facebook/react" });

    expect(res.status).toBe(401);
  });

  it("returns file/size estimates for a valid repo", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ access_token: encrypt("fake-github-token") }] });
    
    const res = await request(app)
      .post("/api/repos/estimate")
      .set("Cookie", authCookie(1))
      .send({ repoUrl: "https://github.com/facebook/react" });
      

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("fileCount");
    expect(res.body).toHaveProperty("estimatedCostUSD");
  });
});

describe("POST /api/repos/:id/chat", () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it("rejects a request with no message", async () => {
    const res = await request(app)
      .post("/api/repos/1/chat")
      .set("Cookie", authCookie(1))
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 for a repo the user doesn't own", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/repos/999/chat")
      .set("Cookie", authCookie(1))
      .send({ message: "hello" });

    expect(res.status).toBe(404);
  });
});