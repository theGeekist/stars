// src/db.ts
import { Database } from "bun:sqlite";

export const db = new Database("repolists.db");

export function initSchema() {
  db.run(`
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
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      watchers INTEGER DEFAULT 0,
      pushed_at TEXT,
      updated_at TEXT,
      popularity REAL,
      freshness REAL,
      activeness REAL
    );

    CREATE TABLE IF NOT EXISTS list_repo (
      list_id INTEGER NOT NULL REFERENCES list(id) ON DELETE CASCADE,
      repo_id INTEGER NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, repo_id)
    );
  `);
}
