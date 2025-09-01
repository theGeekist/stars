// src/lib/db.ts
import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const db = new Database("repolists.db");

function resolveSchemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, "../../sql/schema.sql");

  if (existsSync(candidate)) return candidate;
  const cwdCandidate = resolve(process.cwd(), "sql/schema.sql");
  if (existsSync(cwdCandidate)) return cwdCandidate;

  throw new Error("schema.sql not found");
}

export function initSchema(): void {
  const schemaPath = resolveSchemaPath();
  const sql = readFileSync(schemaPath, "utf-8");
  db.exec(sql);

  migrateIfNeeded(); // optional upgrades
}

// ---- OPTIONAL migration helpers ----
type ColInfo = { name: string };

function quoteIdent(id: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(id)) {
    throw new Error(`Invalid identifier: ${id}`);
  }
  // If you want to allow more, use: `"${id.replace(/"/g, '""')}"`
  return `"${id}"`;
}

function tableColumns(name: string): Set<string> {
  const cols = new Set<string>();
  const ident = quoteIdent(name);
  // No bindings here; PRAGMA doesn't accept parameters for identifiers
  const rows = db.query<ColInfo, []>(`PRAGMA table_info(${ident})`).all();
  for (const r of rows) cols.add(r.name);
  return cols;
}
function addColumnIfMissing(table: string, col: string, sqlType: string) {
  const cols = tableColumns(table);
  if (!cols.has(col))
    db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlType}`);
}
function migrateIfNeeded(): void {
  // Only add *new* columns if missing. Do NOT alter existing cols or tables.
  addColumnIfMissing("repo", "readme_etag", "TEXT");
  addColumnIfMissing("repo", "readme_fetched_at", "TEXT");

  // Ensure helpful indexes exist (no-ops if already present)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_list_slug ON list(slug);
    CREATE INDEX IF NOT EXISTS idx_repo_name ON repo(name_with_owner);
    CREATE INDEX IF NOT EXISTS idx_repo_updated ON repo(updated_at);
    CREATE INDEX IF NOT EXISTS idx_listrepo_list ON list_repo(list_id);
    CREATE INDEX IF NOT EXISTS idx_listrepo_repo ON list_repo(repo_id);
  `);

  // Ensure FTS & triggers exist (idempotent, non-destructive)
  db.exec(`
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
  `);

  // Optional: backfill FTS only if empty (safe; insert-only)
  const ftsCount =
    db
      .query<{ c: number }, []>(
        `SELECT COALESCE(COUNT(*),0) AS c FROM repo_fts`
      )
      .get()?.c ?? 0;
  if (ftsCount === 0) {
    db.exec(`
      INSERT INTO repo_fts(rowid, name_with_owner, description, readme_md, summary, topics)
      SELECT id, name_with_owner, description, readme_md, summary, topics FROM repo;
    `);
  }
}
