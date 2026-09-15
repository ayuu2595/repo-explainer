import express from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { decrypt } from "../utils/crypto.js";
import { parseGitHubRepo, verifyRepoAccess, getEligibleFiles, fetchFileContent } from "../utils/github.js";
import { chunkFile } from "../utils/chunk.js";
import { embedTexts, embedText, toVectorLiteral, generateChatCompletion } from "../utils/embeddings.js";

const router = express.Router();

const MAX_FILES = 800;
const MAX_TOTAL_SIZE_BYTES = 8 * 1024 * 1024;

async function getUserToken(userId) {
  const result = await pool.query("SELECT access_token FROM users WHERE id = $1", [userId]);
  if (result.rows.length === 0) return null;
  return decrypt(result.rows[0].access_token);
}

async function updateProgress(repoId, progress, step) {
  await pool.query("UPDATE repos SET progress = $1, step = $2 WHERE id = $3", [progress, step, repoId]);
}

async function runIngestion(repoId, owner, repo, defaultBranch, token) {
  try {
    await updateProgress(repoId, 5, "Verifying repository access");

    const files = await getEligibleFiles(owner, repo, defaultBranch, token);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (files.length > MAX_FILES || totalSize > MAX_TOTAL_SIZE_BYTES) {
      throw new Error("Repository exceeds size limits for ingestion");
    }

    await updateProgress(repoId, 10, `Found ${files.length} files`);

    const allChunks = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await fetchFileContent(owner, repo, file.path, defaultBranch, token);
      if (content) {
        const chunks = await chunkFile(file.path, content);
        chunks.forEach((chunkText) => {
          allChunks.push({ path: file.path, text: chunkText });
        });
      }

      const fileProgress = 10 + Math.round(((i + 1) / files.length) * 40);
      await updateProgress(repoId, fileProgress, `Reading files (${i + 1}/${files.length})`);
    }

    if (allChunks.length === 0) {
      throw new Error("No text content could be extracted from this repository.");
    }

    await updateProgress(repoId, 55, `Chunked into ${allChunks.length} segments`);

    const BATCH_SIZE = 20;
    const embeddings = [];
    const texts = allChunks.map((c) => c.text);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchEmbeddings = await embedTexts(texts.slice(i, i + BATCH_SIZE));
      embeddings.push(...batchEmbeddings);

      const embedProgress = 55 + Math.round(((i + BATCH_SIZE) / texts.length) * 35);
      await updateProgress(repoId, Math.min(embedProgress, 90), `Generating embeddings (${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length})`);
    }

    await updateProgress(repoId, 92, "Storing vectors in database");

    for (let i = 0; i < allChunks.length; i++) {
      await pool.query(
        "INSERT INTO chunks (repo_id, source_path, content, embedding) VALUES ($1, $2, $3, $4::vector)",
        [repoId, allChunks[i].path, allChunks[i].text, toVectorLiteral(embeddings[i])]
      );
    }

    await pool.query(
      "UPDATE repos SET status = 'ready', progress = 100, step = 'Complete', error = NULL WHERE id = $1",
      [repoId]
    );
  } catch (err) {
    console.error("Ingestion failed:", err.message);
    await pool.query(
      "UPDATE repos SET status = 'failed', error = $1 WHERE id = $2",
      [err.message || "Unknown error", repoId]
    );
  }
}

router.get("/", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, namespace, repo_url, status, progress, step, error, created_at FROM repos WHERE user_id = $1 ORDER BY created_at DESC",
    [req.userId]
  );
  res.json({ repos: result.rows });
});

router.post("/estimate", requireAuth, async (req, res) => {
  try {
    const { repoUrl } = req.body;
    const parsed = parseGitHubRepo(repoUrl);
    if (!parsed) return res.status(400).json({ error: "Invalid GitHub URL" });

    const token = await getUserToken(req.userId);
    const { defaultBranch } = await verifyRepoAccess(parsed.owner, parsed.repo, token);
    const files = await getEligibleFiles(parsed.owner, parsed.repo, defaultBranch, token);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const estimatedChunks = Math.ceil(totalSize / 800);
    const estimatedTokens = Math.ceil(totalSize / 4);
    const estimatedCostUSD = (estimatedTokens / 1_000_000) * 0.15;

    const tooLarge = files.length > MAX_FILES || totalSize > MAX_TOTAL_SIZE_BYTES;

    res.json({
      fileCount: files.length,
      totalSizeKB: Math.round(totalSize / 1024),
      estimatedChunks,
      estimatedCostUSD: Number(estimatedCostUSD.toFixed(4)),
      tooLarge,
      limits: { maxFiles: MAX_FILES, maxTotalSizeKB: Math.round(MAX_TOTAL_SIZE_BYTES / 1024) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/ingest", requireAuth, async (req, res) => {
  const { repoUrl } = req.body;
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) return res.status(400).json({ error: "Invalid GitHub URL" });

  const namespace = `${parsed.owner}/${parsed.repo}`;

  try {
    const existing = await pool.query(
      "SELECT * FROM repos WHERE user_id = $1 AND namespace = $2",
      [req.userId, namespace]
    );

    if (existing.rows.length > 0 && existing.rows[0].status === "ready") {
      return res.json({ success: true, message: "Already ingested", repoId: existing.rows[0].id, skipped: true });
    }

    if (existing.rows.length > 0 && existing.rows[0].status === "ingesting") {
      return res.json({
        success: true,
        message: "Ingestion already in progress",
        repoId: existing.rows[0].id,
        skipped: true,
        alreadyRunning: true,
      });
    }

    const token = await getUserToken(req.userId);
    const { defaultBranch } = await verifyRepoAccess(parsed.owner, parsed.repo, token);

    let repoId;
    if (existing.rows.length > 0) {
      const claim = await pool.query(
        "UPDATE repos SET status = 'ingesting', progress = 0, step = 'Starting', error = NULL WHERE id = $1 AND status != 'ingesting' RETURNING id",
        [existing.rows[0].id]
      );

      if (claim.rows.length === 0) {
        return res.json({
          success: true,
          message: "Ingestion already in progress",
          repoId: existing.rows[0].id,
          skipped: true,
          alreadyRunning: true,
        });
      }

      repoId = claim.rows[0].id;
      await pool.query("DELETE FROM chunks WHERE repo_id = $1", [repoId]);
    } else {
      const inserted = await pool.query(
        "INSERT INTO repos (user_id, namespace, repo_url, status, step) VALUES ($1, $2, $3, 'ingesting', 'Starting') ON CONFLICT (user_id, namespace) DO NOTHING RETURNING id",
        [req.userId, namespace, repoUrl]
      );

      if (inserted.rows.length === 0) {
        const recheck = await pool.query(
          "SELECT id, status FROM repos WHERE user_id = $1 AND namespace = $2",
          [req.userId, namespace]
        );
        return res.json({
          success: true,
          message: "Ingestion already in progress",
          repoId: recheck.rows[0]?.id,
          skipped: true,
          alreadyRunning: true,
        });
      }

      repoId = inserted.rows[0].id;
    }

    runIngestion(repoId, parsed.owner, parsed.repo, defaultBranch, token);

    res.json({ success: true, message: "Ingestion started", repoId, skipped: false });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to start ingestion" });
  }
});

router.get("/:id/progress", requireAuth, async (req, res) => {
  const { id } = req.params;

  const repoCheck = await pool.query("SELECT id FROM repos WHERE id = $1 AND user_id = $2", [id, req.userId]);
  if (repoCheck.rows.length === 0) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const interval = setInterval(async () => {
    const result = await pool.query(
      "SELECT status, progress, step, error FROM repos WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      clearInterval(interval);
      res.end();
      return;
    }

    const row = result.rows[0];
    res.write(`data: ${JSON.stringify(row)}\n\n`);

    if (row.status === "ready" || row.status === "failed") {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

router.post("/:id/summarize", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const repoCheck = await pool.query(
      "SELECT * FROM repos WHERE id = $1 AND user_id = $2",
      [id, req.userId]
    );
    if (repoCheck.rows.length === 0) return res.status(404).json({ error: "Repo not found" });

    const queryEmbedding = await embedText("Project overview and architecture");
    const vectorLiteral = toVectorLiteral(queryEmbedding);

    const matches = await pool.query(
      `SELECT source_path, content FROM chunks
       WHERE repo_id = $1::int
       ORDER BY embedding <=> $2::vector
       LIMIT 100`,
      [id, vectorLiteral]
    );

    if (matches.rows.length === 0) {
      return res.json({
        summary: "No context could be retrieved for this repository.",
        techStack: [],
        patterns: [],
        stats: { files: 0, lines: "0k", languages: 0 },
      });
    }

    const context = matches.rows.map((r) => r.content).join("\n\n");

    const sources = new Set();
    const extensions = new Set();
    let totalLines = 0;

    matches.rows.forEach((r) => {
      sources.add(r.source_path);
      const ext = r.source_path.split(".").pop();
      if (ext) extensions.add(ext);
      totalLines += (r.content.match(/\n/g) || []).length + 1;
    });

    const languageMap = {
      ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
      py: "Python", java: "Java", cpp: "C++", c: "C", rs: "Rust",
      go: "Go", rb: "Ruby", php: "PHP", sql: "SQL", json: "JSON",
      yaml: "YAML", html: "HTML", css: "CSS",
    };
    const languages = new Set();
    extensions.forEach((ext) => {
      if (languageMap[ext]) languages.add(languageMap[ext]);
    });

    let analysis = {
      summary: "A codebase analyzed for architecture and structure.",
      techStack: Array.from(languages),
      patterns: [],
    };

    try {
      const analysisText = await generateChatCompletion(
        `You are a technical architect. Respond ONLY with valid JSON, no markdown formatting.
Format: {"summary": "1-paragraph summary", "techStack": ["tech1"], "patterns": ["pattern1"]}`,
        `Analyze this codebase context and return JSON.\n\n${context}`
      );

      let text = analysisText.trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(text);
      if (parsed.summary) analysis.summary = parsed.summary;
      if (Array.isArray(parsed.techStack)) analysis.techStack = parsed.techStack;
      if (Array.isArray(parsed.patterns)) analysis.patterns = parsed.patterns;
    } catch (err) {
      console.error("Failed to parse analysis JSON:", err.message);
    }

    res.json({
      summary: analysis.summary,
      techStack: analysis.techStack,
      patterns: analysis.patterns,
      stats: {
        files: sources.size,
        lines: `${(totalLines / 1000).toFixed(1)}k`,
        languages: languages.size,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/chat", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { message, history } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const repoCheck = await pool.query(
      "SELECT * FROM repos WHERE id = $1::int AND user_id = $2",
      [id, req.userId]
    );
    if (repoCheck.rows.length === 0) return res.status(404).json({ error: "Repo not found" });

    const repoData = repoCheck.rows[0];
    const [owner, repoName] = repoData.namespace.split("/");

    const token = await getUserToken(req.userId);
    const { defaultBranch } = await verifyRepoAccess(owner, repoName, token);

    const queryEmbedding = await embedText(message);
    const vectorLiteral = toVectorLiteral(queryEmbedding);

    const matches = await pool.query(
      `SELECT source_path, content, embedding <=> $2::vector AS distance
       FROM chunks
       WHERE repo_id = $1::int
       ORDER BY embedding <=> $2::vector
       LIMIT 10`,
      [id, vectorLiteral]
    );

    const sourceMap = new Map();
    matches.rows.forEach((r) => {
      if (!sourceMap.has(r.source_path)) {
        sourceMap.set(r.source_path, {
          path: r.source_path,
          relevance: Number((1 - r.distance).toFixed(3)),
          url: `https://github.com/${owner}/${repoName}/blob/${defaultBranch}/${r.source_path}`,
        });
      }
    });
    const uniqueSources = Array.from(sourceMap.values());

    const context = matches.rows
      .map((r) => `File: ${r.source_path}\n${r.content}`)
      .join("\n\n---\n\n");

    const historyText = Array.isArray(history)
      ? history.map((h) => `${h.role}: ${h.content}`).join("\n")
      : "";

    const systemPrompt = `You are a helpful assistant answering questions about a specific codebase.
Use only the provided code context to answer. If the context doesn't contain the answer, say so honestly.
Be concise and technical. Reference specific file names when relevant.`;

    const userPrompt = `Conversation so far:\n${historyText}\n\nCode context:\n${context}\n\nQuestion: ${message}`;

    const answer = await generateChatCompletion(systemPrompt, userPrompt);

    await pool.query(
      "INSERT INTO messages (repo_id, role, content) VALUES ($1, 'user', $2)",
      [id, message]
    );
    await pool.query(
      "INSERT INTO messages (repo_id, role, content) VALUES ($1, 'assistant', $2)",
      [id, answer]
    );

    res.json({ answer, sources: uniqueSources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/messages", requireAuth, async (req, res) => {
  const { id } = req.params;

  const repoCheck = await pool.query(
    "SELECT id FROM repos WHERE id = $1::int AND user_id = $2",
    [id, req.userId]
  );
  if (repoCheck.rows.length === 0) return res.status(404).json({ error: "Repo not found" });

  const result = await pool.query(
    "SELECT role, content, created_at FROM messages WHERE repo_id = $1::int ORDER BY created_at ASC",
    [id]
  );

  res.json({ messages: result.rows });
});

export default router;