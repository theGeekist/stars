PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS list (
  id INTEGER PRIMARY KEY,
  list_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS repo (
  id INTEGER PRIMARY KEY,
  repo_id TEXT,
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
  readme_etag TEXT,
  readme_fetched_at TEXT,
  summary TEXT,
  tags TEXT,               -- JSON array (derived facets)
  popularity REAL,
  freshness REAL,
  activeness REAL
);

-- === scoring (new tables) ===
CREATE TABLE IF NOT EXISTS model_run (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS repo_list_score (
  run_id INTEGER NOT NULL REFERENCES model_run(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  list_slug TEXT NOT NULL,
  score REAL NOT NULL CHECK(score >= 0 AND score <= 1),
  rationale TEXT,
  PRIMARY KEY (run_id, repo_id, list_slug)
);

CREATE INDEX IF NOT EXISTS idx_score_repo ON repo_list_score(repo_id);
CREATE INDEX IF NOT EXISTS idx_score_run ON repo_list_score(run_id);
CREATE INDEX IF NOT EXISTS idx_score_list ON repo_list_score(list_slug);


CREATE TABLE IF NOT EXISTS list_repo (
  list_id INTEGER NOT NULL REFERENCES list(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, repo_id)
);

-- core indexes
CREATE INDEX IF NOT EXISTS idx_list_slug ON list(slug);
CREATE INDEX IF NOT EXISTS idx_repo_name ON repo(name_with_owner);
CREATE INDEX IF NOT EXISTS idx_repo_updated ON repo(updated_at);
CREATE INDEX IF NOT EXISTS idx_listrepo_list ON list_repo(list_id);
CREATE INDEX IF NOT EXISTS idx_listrepo_repo ON list_repo(repo_id);

-- topics: one row per canonical topic string (lowercase, kebab-case)
CREATE TABLE IF NOT EXISTS topics (
  topic               TEXT PRIMARY KEY,          -- e.g. "rss-reader"
  display_name        TEXT,                      -- e.g. "RSS Reader"
  short_description   TEXT,                      -- front-matter 'short_description' (or fallback)
  long_description_md TEXT,                      -- Markdown body from github/explore topic page
  is_featured         INTEGER NOT NULL DEFAULT 0,
  created_by          TEXT,                      -- front-matter 'created_by'
  released            TEXT,                      -- front-matter 'released' (string; could be year or date)
  wikipedia_url       TEXT,                      -- front-matter 'wikipedia_url'
  logo                TEXT,                      -- front-matter 'logo' filename (if present)
  updated_at          TEXT NOT NULL,             -- ISO8601 when we last refreshed this row
  etag                TEXT                       -- reserved (not used for explore)
);

-- topic_alias: alias -> canonical topic
CREATE TABLE IF NOT EXISTS topic_alias (
  alias TEXT PRIMARY KEY,
  topic TEXT NOT NULL REFERENCES topics(topic) ON DELETE CASCADE
);

-- topic_related: undirected edges between canonical topics; store once (a<b)
CREATE TABLE IF NOT EXISTS topic_related (
  a TEXT NOT NULL REFERENCES topics(topic) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES topics(topic) ON DELETE CASCADE,
  PRIMARY KEY (a, b),
  CHECK (a < b)
);

CREATE INDEX IF NOT EXISTS idx_topics_display_name ON topics(display_name);
CREATE INDEX IF NOT EXISTS idx_topics_updated_at   ON topics(updated_at);
CREATE INDEX IF NOT EXISTS idx_topic_alias_topic   ON topic_alias(topic);

-- repo_topics: many-to-many between your repos (by internal id) and topics
CREATE TABLE IF NOT EXISTS repo_topics (
  repo_id   INTEGER NOT NULL,                   -- FK to your repos table's id
  topic     TEXT NOT NULL,                      -- FK to topics.topic
  added_at  TEXT NOT NULL,                      -- when we attached (or last confirmed) the mapping
  PRIMARY KEY (repo_id, topic),
  FOREIGN KEY (topic) REFERENCES topics(topic) ON DELETE CASCADE
  -- FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE -- if you have it
);

-- perf helpers
CREATE INDEX IF NOT EXISTS idx_repo_topics_repo ON repo_topics (repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_topics_topic ON repo_topics (topic);



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
