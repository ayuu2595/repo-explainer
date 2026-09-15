CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  github_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  access_token TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repos (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INT DEFAULT 0,
  step TEXT,
  error TEXT,
  last_commit_sha TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, namespace)
);

CREATE TABLE IF NOT EXISTS chunks (
  id SERIAL PRIMARY KEY,
  repo_id INT REFERENCES repos(id) ON DELETE CASCADE,
  source_path TEXT,
  content TEXT,
  embedding vector(1536),
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_content_tsv_idx ON chunks USING GIN (content_tsv);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  repo_id INT REFERENCES repos(id) ON DELETE CASCADE,
  role TEXT,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);