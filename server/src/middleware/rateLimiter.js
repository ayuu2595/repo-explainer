import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { pool } from "../config/db.js";

export const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  message: { error: "Too many chat requests. Please wait a moment before trying again." },
});

export const ingestRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  message: { error: "Too many ingestion requests. Please wait a moment before trying again." },
});

const DAILY_INGEST_LIMIT = 10;

export async function dailyIngestQuota(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM repos
       WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [req.userId]
    );

    const count = parseInt(result.rows[0].count, 10);

    if (count >= DAILY_INGEST_LIMIT) {
      return res.status(429).json({
        error: `Daily ingestion limit reached (${DAILY_INGEST_LIMIT} repos per 24 hours). Try again later.`,
      });
    }

    next();
  } catch (err) {
    next();
  }
}