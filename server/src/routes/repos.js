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

router.get("/", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, namespace, repo_url, status, progress, created_at FROM repos WHERE user_id = $1 ORDER BY created_at DESC",
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

    const token = await getUserToken(req.userId);
    const { defaultBranch } = await verifyRepoAccess(parsed.owner, parsed.repo, token);
    const files = await getEligibleFiles(parsed.owner, parsed.repo, defaultBranch, token);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (files.length > MAX_FILES || totalSize > MAX_TOTAL_SIZE_BYTES) {
      return res.status(400).json({ error: "Repository exceeds size limits for ingestion" });
    }

    let repoId;
    if (existing.rows.length > 0) {
      repoId = existing.rows[0].id;
      await pool.query("UPDATE repos SET status = 'ingesting', progress = 0 WHERE id = $1", [repoId]);
      await pool.query("DELETE FROM chunks WHERE repo_id = $1", [repoId]);
    } else {
      const inserted = await pool.query(
        "INSERT INTO repos (user_id, namespace, repo_url, status) VALUES ($1, $2, $3, 'ingesting') RETURNING id",
        [req.userId, namespace, repoUrl]
      );
      repoId = inserted.rows[0].id;
    }

    const tStart = performance.now();

    const allChunks = [];

    for (const file of files) {
      const content = await fetchFileContent(parsed.owner, parsed.repo, file.path, defaultBranch, token);
      if (!content) continue;

      const chunks = await chunkFile(file.path, content);
      if (chunks.length === 0) continue;

      chunks.forEach((chunkText) => {
        allChunks.push({ path: file.path, text: chunkText });
      });
    }

    if (allChunks.length === 0) {
      throw new Error("No text content could be extracted from this repository.");
    }

    const embeddings = await embedTexts(allChunks.map((c) => c.text));

    for (let i = 0; i < allChunks.length; i++) {
      await pool.query(
        "INSERT INTO chunks (repo_id, source_path, content, embedding) VALUES ($1, $2, $3, $4::vector)",
        [repoId, allChunks[i].path, allChunks[i].text, toVectorLiteral(embeddings[i])]
      );
    }

    const totalMs = Math.round(performance.now() - tStart);

    await pool.query("UPDATE repos SET status = 'ready', progress = 100 WHERE id = $1", [repoId]);

    res.json({ success: true, message: "Ingestion complete", repoId, totalMs, filesProcessed: files.length, chunksCreated: allChunks.length });
  } catch (err) {
    if (err.message) {
      console.error("Ingestion failed:", err.message);
    }
    res.status(500).json({ error: err.message || "Ingestion failed" });
  }
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
       WHERE repo_id = $1
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

export default router;