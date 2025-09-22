import type { Statement } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { initBootstrap } from "@lib/bootstrap";
import { getDefaultDb } from "@lib/db";
import { createLogger, getLogTap, setLogTap } from "@lib/logger";
import type { RepoRow } from "@lib/types";
import { parseJsonArray } from "@lib/utils";
import { ingestListedFromGh, ingestUnlistedFromGh } from "@src/api/ingest";
import { rankAll } from "@src/api/ranking.public";
import { runLists } from "@src/api/stars";
import { summariseAll } from "@src/api/summarise.public";
import { enrichAllRepoTopics } from "@src/api/topics";
import type { ApiRepo, ListDetail, ListRow } from "./types";

let qLists!: Statement<ListRow, []>;
let qListBySlug!: Statement<ListDetail, [slug: string]>;
let qReposForList!: Statement<RepoRow, [list_id: number]>;
let qSearchFts!: Statement<RepoRow, [q: string]>;
let qSearchLike!: Statement<RepoRow, [q1: string, q2: string]>;
let qCountLists!: Statement<{ n: number }, []>;
let qCountRepos!: Statement<{ n: number }, []>;
let qCountSummarised!: Statement<{ n: number }, []>;
let qCountScored!: Statement<{ n: number }, []>;
let qPerListCounts!: Statement<{ slug: string; name: string; n: number }, []>;

// --- SSE log state ---
type SseClient = {
	controller: ReadableStreamDefaultController<Uint8Array>;
	iv: ReturnType<typeof setInterval>;
};
const sseClients = new Set<SseClient>();
const encoder = new TextEncoder();
const logHistory: string[] = [];
let lastSseLine = "";
const MAX_HISTORY = 1000;

// Track running child processes for cancel/status
type RunningProc = {
	task: string;
	cmd: string[];
	proc: { kill: () => void } | ReturnType<typeof Bun.spawn>;
	controller?: AbortController;
	startedAt: string;
};
const running = new Map<number, RunningProc>();
let nextLocalPid = 100000; // pseudo PIDs for in-process tasks

// Ensure DB/bootstrap has been initialised
initBootstrap();

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

	qCountLists = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM list`);
	qCountRepos = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM repo`);
	qCountSummarised = db.query<{ n: number }, []>(
		`SELECT COUNT(*) AS n FROM repo WHERE summary IS NOT NULL AND TRIM(summary) <> ''`,
	);
	qCountScored = db.query<{ n: number }, []>(
		`SELECT COUNT(DISTINCT repo_id) AS n FROM repo_list_score`,
	);
	qPerListCounts = db.query<{ slug: string; name: string; n: number }, []>(
		`SELECT l.slug AS slug, l.name AS name, COUNT(lr.repo_id) AS n
         FROM list l LEFT JOIN list_repo lr ON l.id = lr.list_id
         GROUP BY l.id
         ORDER BY l.name`,
	);
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

/* ------------------------- Dashboard counts (JSON + DB) ------------------------- */

type DashboardCounts = {
	json: { lists: number; repos: number; unlisted: number };
	db: {
		lists: number;
		repos: number;
		summarised: number;
		scored: number;
		perList: Array<{ slug: string; name: string; repos: number }>;
	};
};

function safeParse<T>(path: string, fallback: T): T {
	try {
		if (existsSync(path)) {
			const raw = readFileSync(path, "utf8");
			return JSON.parse(raw) as T;
		}
	} catch {
		// ignore
	}
	return fallback;
}

function computeJsonCounts(dir: string): {
	lists: number;
	repos: number;
	unlisted: number;
} {
	const base = resolve(dir || "./exports");
	// lists: <dir>/index.json (array of list summaries with count)
	const listIndex = safeParse<Array<{ count?: number }>>(
		join(base, "index.json"),
		[],
	);
	const lists = Array.isArray(listIndex) ? listIndex.length : 0;
	const repos = Array.isArray(listIndex)
		? listIndex.reduce((acc, it) => acc + (Number(it?.count ?? 0) || 0), 0)
		: 0;
	// unlisted: <dir>/unlisted.json (array)
	const unlistedArr = safeParse<unknown[]>(join(base, "unlisted.json"), []);
	const unlisted = Array.isArray(unlistedArr) ? unlistedArr.length : 0;
	return { lists, repos, unlisted };
}

function computeDbCounts(): DashboardCounts["db"] {
	const lists = qCountLists.get()?.n ?? 0;
	const repos = qCountRepos.get()?.n ?? 0;
	const summarised = qCountSummarised.get()?.n ?? 0;
	const scored = qCountScored.get()?.n ?? 0;
	const perList = qPerListCounts
		.all()
		.map((r) => ({ slug: r.slug, name: r.name, repos: r.n }));
	return { lists, repos, summarised, scored, perList };
}

function handleDashboard(dir?: string): Response {
	const jsonCounts = computeJsonCounts(dir ?? "./exports");
	const dbCounts = computeDbCounts();
	const data: DashboardCounts = { json: jsonCounts, db: dbCounts };
	return json(data);
}

/* ------------------------------ Task runners ------------------------------ */

function sseBroadcast(line: string): void {
	if (line === lastSseLine) return;
	lastSseLine = line;
	logHistory.push(line);
	if (logHistory.length > MAX_HISTORY)
		logHistory.splice(0, logHistory.length - MAX_HISTORY);
	const payload = encoder.encode(`data: ${line}\n\n`);
	for (const c of sseClients) {
		try {
			c.controller.enqueue(payload);
		} catch {
			// ignore broken pipes
		}
	}
}

function handleRun(path: string, dir?: string): Response {
	const d = dir ?? undefined;
	switch (path) {
		case "lists":
		case "ingest":
		case "summarise":
		case "score":
		case "topics:enrich":
			return startInProcess(path, d);
		default:
			return json({ error: "Unknown task" }, 400);
	}
}

function anyInprocRunning(): boolean {
	for (const r of running.values()) {
		if (r.cmd && r.cmd[0] === "__inproc__") return true;
	}
	return false;
}

function startInProcess(task: string, _dir?: string): Response {
	if (anyInprocRunning())
		return json({ error: "Another in-process task is running" }, 409);
	const startedAt = new Date().toISOString();
	const pid = nextLocalPid++;
	const controller = new AbortController();
	const rec: RunningProc = {
		task,
		cmd: ["__inproc__", task],
		proc: {
			kill: () => {
				/* no-op for now */
			},
		},
		controller,
		startedAt,
	};
	running.set(pid, rec);
	// Do not broadcast synthetic [start] lines for in-process tasks

	const prevTap = getLogTap();
	setLogTap((type, line) => {
		const kind = type === "error" || type === "err" ? "err" : "out";
		sseBroadcast(`[${task}|${kind}] ${line}`);
	});

	(async () => {
		try {
			switch (task) {
				case "lists":
					await runLists(false, undefined, undefined);
					break;
				case "ingest":
					// Replace legacy ingest-from-disk with GH-driven ingestion
					await ingestListedFromGh(undefined, undefined, controller.signal);
					if (controller.signal.aborted) throw new Error("Aborted");
					await ingestUnlistedFromGh(undefined, undefined, controller.signal);
					break;
				case "summarise":
					await summariseAll({
						dry: false, // Apply mode for server
						onProgress: (e) => {
							const progress =
								e.index !== undefined && e.total !== undefined
									? `${e.index}/${e.total}`
									: e.repo || "processing";
							sseBroadcast(`[${task}|progress] ${e.phase}: ${progress}`);
						},
					});
					break;
				case "score":
					await rankAll({
						dry: false, // Apply mode for server
						onProgress: (e) => {
							const progress =
								e.index !== undefined && e.total !== undefined
									? `${e.index}/${e.total}`
									: e.repo || "processing";
							sseBroadcast(`[${task}|progress] ${e.phase}: ${progress}`);
						},
					});
					break;
				case "topics:enrich":
					await enrichAllRepoTopics();
					break;
			}
			sseBroadcast(`[end] pid=${pid} task=${task} code=0`);
		} catch (e) {
			sseBroadcast(
				`[end-error] pid=${pid} task=${task} err=${e instanceof Error ? e.message : String(e)}`,
			);
		} finally {
			running.delete(pid);
			setLogTap(prevTap);
		}
	})();

	return json({ ok: true, pid, cmd: rec.cmd, cancellable: true }, 202);
}

function handleStatus(): Response {
	const list = Array.from(running.entries()).map(([pid, r]) => ({
		pid,
		task: r.task,
		cmd: r.cmd,
		startedAt: r.startedAt,
		cancellable: true,
	}));
	return json({ running: list });
}

function handleCancel(pidStr: string): Response {
	const pid = Number(pidStr);
	if (!pid || !Number.isFinite(pid)) return json({ error: "Invalid pid" }, 400);
	const rec = running.get(pid);
	if (!rec) return json({ error: "Not running" }, 404);
	try {
		// Support cancel for in-process tasks via AbortController
		if (rec.cmd && rec.cmd[0] === "__inproc__") {
			try {
				(rec.controller as AbortController | undefined)?.abort();
				sseBroadcast(`[cancel] pid=${pid} task=${rec.task}`);
				return json({ ok: true });
			} catch (e) {
				return json(
					{ ok: false, error: e instanceof Error ? e.message : String(e) },
					500,
				);
			}
		}
		// Try SIGTERM first; Bun.spawn returns a process with .kill
		rec.proc.kill();
		sseBroadcast(`[cancel] pid=${pid} task=${rec.task}`);
		return json({ ok: true });
	} catch (e) {
		return json(
			{ ok: false, error: e instanceof Error ? e.message : String(e) },
			500,
		);
	}
}

Bun.serve({
	port: 8787,
	fetch(req) {
		try {
			const url = new URL(req.url);
			const { pathname } = url;

			if (pathname === "/health") return handleHealth();
			if (pathname === "/dashboard") {
				const dir = url.searchParams.get("dir") ?? undefined;
				return handleDashboard(dir);
			}
			if (pathname === "/logs") {
				let client: SseClient | null = null;
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						client = {
							controller,
							iv: setInterval(() => {
								try {
									controller.enqueue(encoder.encode(": keepalive\n\n"));
								} catch {
									// ignore
								}
							}, 15000),
						};
						sseClients.add(client);
						controller.enqueue(encoder.encode(": connected\n\n"));
						for (const line of logHistory)
							controller.enqueue(encoder.encode(`data: ${line}\n\n`));
					},
					cancel() {
						if (client && sseClients.has(client)) {
							clearInterval(client.iv);
							sseClients.delete(client);
						}
					},
				});
				return new Response(stream, {
					headers: {
						"content-type": "text/event-stream; charset=utf-8",
						"cache-control": "no-cache",
						connection: "keep-alive",
					},
				});
			}

			if (pathname === "/run/status") return handleStatus();
			if (pathname.startsWith("/run/cancel/")) {
				if (req.method !== "POST")
					return json({ error: "Method not allowed" }, 405);
				const pid = pathname.slice("/run/cancel/".length);
				return handleCancel(pid);
			}
			if (pathname === "/lists") return handleGetLists();
			if (pathname.startsWith("/list/"))
				return handleGetListBySlug(pathname.replace("/list/", "").trim());
			if (pathname === "/search")
				return handleSearch(url.searchParams.get("q") ?? "");
			if (pathname.startsWith("/run/")) {
				if (req.method !== "POST")
					return json({ error: "Method not allowed" }, 405);
				const task = pathname.slice("/run/".length);
				const dir = url.searchParams.get("dir") ?? undefined;
				return handleRun(task, dir);
			}

			// Static UI assets from ./public
			const filePath =
				pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
			const abs = resolve("public", filePath);
			if (existsSync(abs)) {
				const file = Bun.file(abs);
				const contentType = filePath.endsWith(".html")
					? "text/html; charset=utf-8"
					: filePath.endsWith(".js")
						? "text/javascript; charset=utf-8"
						: filePath.endsWith(".css")
							? "text/css; charset=utf-8"
							: undefined;
				return new Response(
					file,
					contentType
						? { headers: { "content-type": contentType } }
						: undefined,
				);
			}

			return notFound();
		} catch (err) {
			return json({ error: String(err) }, 500);
		}
	},
});

createLogger().success("API → http://localhost:8787");
