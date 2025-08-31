PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS list (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS repo (
  id INTEGER PRIMARY KEY,
  name_with_owner TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  homepage_url TEXT,
  stars INTEGER DEFAULT 0,
  forks INTEGER DEFAULT 0,
  watchers INTEGER DEFAULT 0,
  open_issues INTEGER DEFAULT 0,
  open_prs INTEGER DEFAULT 0,
  default_branch TEXT,
  last_commit_iso TEXT,
  last_release_iso TEXT,
  topics TEXT,             -- JSON array
  primary_language TEXT,
  languages TEXT,          -- JSON array of strings
  license TEXT,
  is_archived INTEGER DEFAULT 0,
  is_disabled INTEGER DEFAULT 0,
  is_fork INTEGER DEFAULT 0,
  is_mirror INTEGER DEFAULT 0,
  has_issues_enabled INTEGER DEFAULT 1,
  pushed_at TEXT,
  updated_at TEXT,
  created_at TEXT,
  disk_usage INTEGER,
  -- enrichment (optional later)
  readme_md TEXT,
  summary TEXT,
  tags TEXT,               -- JSON array (derived facets)
  popularity REAL,
  freshness REAL,
  activeness REAL
);

CREATE TABLE IF NOT EXISTS list_repo (
  list_id INTEGER NOT NULL REFERENCES list(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, repo_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS repo_fts USING fts5(
  name_with_owner, description, readme_md, summary, topics,
  content='repo', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS repo_ai AFTER INSERT ON repo BEGIN
  INSERT INTO repo_fts(rowid, name_with_owner, description, readme_md, summary, topics)
  VALUES (new.id, new.name_with_owner, new.description, new.readme_md, new.summary, new.topics);
END;
CREATE TRIGGER IF NOT EXISTS repo_ad AFTER DELETE ON repo BEGIN
  INSERT INTO repo_fts(repo_fts, rowid, name_with_owner, description, readme_md, summary, topics)
  VALUES('delete', old.id, old.name_with_owner, old.description, old.readme_md, old.summary, old.topics);
END;
CREATE TRIGGER IF NOT EXISTS repo_au AFTER UPDATE ON repo BEGIN
  INSERT INTO repo_fts(repo_fts, rowid, name_with_owner, description, readme_md, summary, topics)
  VALUES('delete', old.id, old.name_with_owner, old.description, old.readme_md, old.summary, old.topics);
  INSERT INTO repo_fts(rowid, name_with_owner, description, readme_md, summary, topics)
  VALUES (new.id, new.name_with_owner, new.description, new.readme_md, new.summary, new.topics);
END;
