export function parseGitHubRepo(repoUrl) {
  try {
    const { hostname, pathname } = new URL(repoUrl);
    if (hostname !== "github.com" && hostname !== "www.github.com") return null;
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

export async function verifyRepoAccess(owner, repo, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-explainer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

  if (res.ok) {
    const data = await res.json();
    return { defaultBranch: data.default_branch || "main" };
  }

  if (res.status === 401) throw new Error("GitHub token is invalid or expired.");
  if (res.status === 403) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub rate limit reached. Try again later.");
    }
    throw new Error("Access forbidden. Token may lack required permissions.");
  }
  if (res.status === 404) throw new Error("Repository not found or inaccessible.");
  throw new Error(`GitHub returned ${res.status}.`);
}

const IGNORED_EXTENSIONS = new Set([
  "png","jpg","jpeg","gif","svg","ico","pdf","docx",
  "woff","woff2","ttf","eot","lock","zip","tar","gz",
]);

const IGNORED_PATH_SEGMENTS = ["node_modules", ".git", "__pycache__", "dist", "build", "vendor"];

const IGNORED_FILENAMES = new Set([
  "package-lock.json","yarn.lock","pnpm-lock.yaml","composer.lock","Gemfile.lock","poetry.lock",
]);

const MAX_FILE_SIZE_BYTES = 200 * 1024;

function isEligible(path, size) {
  const segments = path.split("/");
  if (segments.some((s) => IGNORED_PATH_SEGMENTS.includes(s))) return false;

  const filename = segments[segments.length - 1];
  if (IGNORED_FILENAMES.has(filename)) return false;

  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && IGNORED_EXTENSIONS.has(ext)) return false;

  if (size > MAX_FILE_SIZE_BYTES) return false;

  return true;
}

export async function getEligibleFiles(owner, repo, branch, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-explainer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );

  if (!res.ok) throw new Error(`Failed to load repository tree (${res.status})`);

  const data = await res.json();
  const files = (data.tree || []).filter((item) => item.type === "blob");

  return files
    .filter((f) => isEligible(f.path, f.size || 0))
    .map((f) => ({ path: f.path, size: f.size || 0, sha: f.sha }));
}

export async function fetchFileContent(owner, repo, path, branch, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-explainer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
    { headers }
  );

  if (!res.ok) return null;

  const data = await res.json();
  if (!data.content) return null;

  try {
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");

    if (decoded.includes("\u0000")) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}


export async function getLatestCommitSha(owner, repo, branch, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-explainer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`,
    { headers }
  );

  if (!res.ok) throw new Error(`Failed to fetch latest commit (${res.status})`);

  const data = await res.json();
  return data.sha;
}

export async function getChangedFiles(owner, repo, baseSha, headSha, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-explainer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
    { headers }
  );

  if (!res.ok) throw new Error(`Failed to compare commits (${res.status})`);

  const data = await res.json();
  return (data.files || []).map((f) => ({
    path: f.filename,
    status: f.status,
  }));
}