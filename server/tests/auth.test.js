import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";

jest.unstable_mockModule("../src/config/db.js", () => ({
  pool: { query: jest.fn() },
}));

const { pool } = await import("../src/config/db.js");
const { requireAuth } = await import("../src/middleware/auth.js");

const app = express();
app.use(cookieParser());
app.get("/protected", requireAuth, (req, res) => {
  res.json({ userId: req.userId });
});

describe("requireAuth middleware", () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it("rejects a request with no token", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects a request with an invalid token", async () => {
    const res = await request(app).get("/protected").set("Cookie", "token=garbage");
    expect(res.status).toBe(401);
  });

  it("accepts a request with a valid token", async () => {
    const token = jwt.sign({ userId: 42 }, "test-secret");
    const res = await request(app).get("/protected").set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(42);
  });
});