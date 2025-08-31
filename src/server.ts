import { db } from "./lib/db";
import { Statement } from "bun:sqlite";

type ListRow = {
  id: number;
  name: string;
  description: string | null;
  slug: string;
  is_private: number;
};
type ListDetail = { id: number; name: string; description: string | null };
type RepoRow = {
  id: number;
  name_with_owner: string;
  url: string;
  description: string | null;
  primary_language: string | null;
  license: string | null;
  tags: string | null;
  summary: string | null;
  popularity: number | null;
  freshness: number | null;
  activeness: number | null;
};

let qLists!: Statement<ListRow, []>;
let qListBySlug!: Statement<ListDetail, [slug: string]>;
let qReposForList!: Statement<RepoRow, [list_id: number]>;
let qSearchFts!: Statement<RepoRow, [q: string]>;
let qSearchLike!: Statement<RepoRow, [q1: string, q2: string]>;

function prepareQueries(): void {
  qLists = db.query<ListRow, []>(`
    SELECT id, name, description, slug, is_private FROM list ORDER BY name
  `);

  qListBySlug = db.query<ListDetail, [string]>(`
    SELECT id, name, description FROM list WHERE slug = ?
  `);

  qReposForList = db.query<RepoRow, [number]>(`
    SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.license, r.tags, r.summary,
           r.popularity, r.freshness, r.activeness
    FROM repo r
    JOIN list_repo lr ON r.id = lr.repo_id
    WHERE lr.list_id = ?
    ORDER BY r.popularity DESC
  `);

  qSearchFts = db.query<RepoRow, [string]>(`
    SELECT id, name_with_owner, url, description, primary_language, license, tags, summary, popularity, freshness, activeness
    FROM repo
    WHERE rowid IN (SELECT rowid FROM repo_fts WHERE repo_fts MATCH ?)
    ORDER BY popularity DESC
    LIMIT 100
  `);

  qSearchLike = db.query<RepoRow, [string, string]>(`
    SELECT id, name_with_owner, url, description, primary_language, license, tags, summary, popularity, freshness, activeness
    FROM repo
    WHERE name_with_owner LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%'
    ORDER BY popularity DESC
    LIMIT 100
  `);
}

function json(res: unknown, init?: number | ResponseInit): Response {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (typeof init === "number") return new Response(JSON.stringify(res), { status: init, headers });
  return new Response(JSON.stringify(res), { ...(init as ResponseInit), headers });
}
function notFound(msg = "Not found"): Response {
  return json({ error: msg }, 404);
}

prepareQueries();

Bun.serve({
  port: 8787,
  fetch(req) {
    try {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/health") return json({ ok: true });

      if (pathname === "/lists") {
        const rows = qLists.all(); // [] bindings
        return json(rows);
      }

      if (pathname.startsWith("/list/")) {
        const slug = pathname.replace("/list/", "").trim();
        if (!slug) return notFound();
        const list = qListBySlug.get(slug);
        if (!list) return notFound();

        const repos = qReposForList.all(list.id);
        return json({ list, repos });
      }

      if (pathname === "/search") {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) return json([]);
        let rows: RepoRow[] = [];
        try {
          rows = qSearchFts.all(q);
        } catch {
          rows = qSearchLike.all(q,q);
        }
        return json(rows);
      }

      return notFound();
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
});

console.log("API → http://localhost:8787");
