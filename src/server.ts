import type { Statement } from "bun:sqlite";
import { getDefaultDb } from "@lib/db";
import { createLogger } from "@lib/logger";
import type { RepoRow } from "@lib/types";
import { parseJsonArray } from "@lib/utils";
import type { ApiRepo, ListDetail, ListRow } from "./types";

let qLists!: Statement<ListRow, []>;
let qListBySlug!: Statement<ListDetail, [slug: string]>;
let qReposForList!: Statement<RepoRow, [list_id: number]>;
let qSearchFts!: Statement<RepoRow, [q: string]>;
let qSearchLike!: Statement<RepoRow, [q1: string, q2: string]>;

function mapRepoRow(row: RepoRow): ApiRepo {
	return {
		...row,
		tags: parseJsonArray(row.tags),
	};
}

function prepareQueries(): void {
	const db = getDefaultDb();
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
	if (typeof init === "number")
		return new Response(JSON.stringify(res), { status: init, headers });
	return new Response(JSON.stringify(res), {
		...(init as ResponseInit),
		headers,
	});
}

function notFound(msg = "Not found"): Response {
	return json({ error: msg }, 404);
}

prepareQueries();

function handleHealth(): Response {
	return json({ ok: true });
}

function handleGetLists(): Response {
	const rows = qLists.all();
	return json(rows);
}

function handleGetListBySlug(slug: string): Response {
	if (!slug) return notFound();
	const list = qListBySlug.get(slug);
	if (!list) return notFound();
	const repos = qReposForList.all(list.id).map(mapRepoRow);
	return json({ list, repos });
}

function handleSearch(q: string): Response {
	const query = (q ?? "").trim();
	if (!query) return json([]);
	let rows: RepoRow[] = [];
	try {
		rows = qSearchFts.all(query);
	} catch {
		rows = qSearchLike.all(query, query);
	}
	const repos = rows.map(mapRepoRow);
	return json(repos);
}

Bun.serve({
	port: 8787,
	fetch(req) {
		try {
			const url = new URL(req.url);
			const { pathname } = url;

			if (pathname === "/health") return handleHealth();
			if (pathname === "/lists") return handleGetLists();
			if (pathname.startsWith("/list/"))
				return handleGetListBySlug(pathname.replace("/list/", "").trim());
			if (pathname === "/search")
				return handleSearch(url.searchParams.get("q") ?? "");

			return notFound();
		} catch (err) {
			return json({ error: String(err) }, 500);
		}
	},
});

createLogger().success("API → http://localhost:8787");
