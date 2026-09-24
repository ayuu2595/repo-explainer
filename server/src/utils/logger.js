import { pool } from "../config/db.js";

const EMBEDDING_COST_PER_1M = 0.15;
const CHAT_INPUT_COST_PER_1M = 0.075;
const CHAT_OUTPUT_COST_PER_1M = 0.30;

export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

export async function logRequest({
  userId,
  repoId,
  endpoint,
  durationMs,
  embeddingTokens = 0,
  chatInputTokens = 0,
  chatOutputTokens = 0,
  status,
  error,
}) {
  const embeddingCost = (embeddingTokens / 1_000_000) * EMBEDDING_COST_PER_1M;
  const chatInputCost = (chatInputTokens / 1_000_000) * CHAT_INPUT_COST_PER_1M;
  const chatOutputCost = (chatOutputTokens / 1_000_000) * CHAT_OUTPUT_COST_PER_1M;
  const totalCost = embeddingCost + chatInputCost + chatOutputCost;

  try {
    await pool.query(
      `INSERT INTO request_logs
       (user_id, repo_id, endpoint, duration_ms, embedding_tokens, chat_input_tokens, chat_output_tokens, estimated_cost_usd, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [userId, repoId || null, endpoint, durationMs, embeddingTokens, chatInputTokens, chatOutputTokens, totalCost, status, error || null]
    );
  } catch (err) {
    console.error("Failed to log request:", err.message);
  }
}