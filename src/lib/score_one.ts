// src/lib/score_one.ts
import { OllamaService } from "@jasonnathan/llm-core";
import {
	scoreRepoAgainstLists,
	diffMembership,
	type ListDef,
	type RepoFacts,
} from "./score";
import { initSchema, db } from "./db";
import type { RepoRow } from "./types";
import { githubGraphQL } from "./github";
import { LISTS_EDGES_PAGE, M_UPDATE_LISTS_FOR_ITEM, Q_REPO_ID } from "./lists";

type ListRow = {
	id: number;
	listId: string;
	slug: string;
	name: string;
	description: string | null;
};
type CurrentListRow = { slug: string };

const qRepoByName = db.query<RepoRow, [string]>(`
  SELECT id, name_with_owner, url, description, primary_language, topics, summary
  FROM repo
  WHERE name_with_owner = ?
  LIMIT 1
`);
const qRepoById = db.query<RepoRow, [number]>(`
  SELECT id, repo_id, name_with_owner, url, description, primary_language, topics, summary
  FROM repo WHERE id = ? LIMIT 1
`);

const qLists = db.query<
	{
		id: number;
		slug: string;
		name: string;
		list_id: string | null;
		description: string;
	},
	[]
>(`SELECT id, slug, name, list_id, description FROM list ORDER BY name`);
const qCurrentMembership = db.query<CurrentListRow, [number]>(`
  SELECT l.slug
  FROM list l
  JOIN list_repo lr ON lr.list_id = l.id
  WHERE lr.repo_id = ?
  ORDER BY l.name
`);

const uListGhId = db.query<unknown, [string, number]>(
	`UPDATE list SET list_id = ? WHERE id = ?`,
);

const uRepoGhId = db.query<unknown, [string, number]>(
	`UPDATE repo SET repo_id = ? WHERE id = ?`,
);

const qListIdBySlug = db.query<{ id: number }, [string]>(
	`SELECT id FROM list WHERE slug = ? LIMIT 1`,
);

// reconcile list_repo to an exact set of slugs
export function reconcileLocalListRepoBySlugs(
	repoId: number,
	targetSlugs: string[],
): void {
	const ts = db.transaction(() => {
		// insert/confirm
		for (const slug of targetSlugs) {
			const lr = db.query<unknown, [string, number]>(`
				INSERT INTO list_repo (list_id, repo_id)
				VALUES ((SELECT id FROM list WHERE slug = ?), ?)
				ON CONFLICT(list_id, repo_id) DO NOTHING
			`);
			lr.run(slug, repoId);
		}
		// delete not in target
		const placeholders = targetSlugs.length
			? targetSlugs.map(() => "?").join(",")
			: "''";
		const del = db.query<unknown, (number | string)[]>(
			`DELETE FROM list_repo
       WHERE repo_id = ?
         AND list_id NOT IN (SELECT id FROM list WHERE slug IN (${placeholders}))`,
		);
		del.run(repoId, ...targetSlugs);
	});
	ts();
}

// ─────────────────────────── GH <-> DB sync ─────────────────────────

export interface ListsEdgesPageData {
	viewer: {
		lists: {
			pageInfo: {
				endCursor: string | null;
				hasNextPage: boolean;
			};
			edges: {
				cursor: string;
				node: {
					listId: string; // ← aliased in your query
					name: string;
					description?: string | null;
					isPrivate: boolean;
				};
			}[];
		};
	};
}

/** Ensure list.list_id is filled by matching your lists to GH viewer lists by NAME. */
export async function ensureGhListIds(
	token: string,
): Promise<Map<string, string>> {
	// 1) Page through viewer.lists
	const ghByLowerName = new Map<string, string>();
	let after: string | null = null;

	for (;;) {
		const data: ListsEdgesPageData = await githubGraphQL<ListsEdgesPageData>(
			token,
			LISTS_EDGES_PAGE,
			{ after },
		);
		const page = data.viewer.lists;

		for (const e of page.edges) {
			const { listId, name } = e.node;
			ghByLowerName.set(name.toLowerCase(), listId);
		}

		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor;
	}

	// 2) Fill DB list.list_id where missing, by name match
	const rows = qLists.all();
	const slugToGh = new Map<string, string>();

	for (const r of rows) {
		if (r.list_id) {
			slugToGh.set(r.slug, r.list_id);
			continue;
		}
		const ghId = ghByLowerName.get(r.name.toLowerCase());
		if (ghId) {
			uListGhId.run(ghId, r.id);
			slugToGh.set(r.slug, ghId);
		}
	}

	return slugToGh;
}

/** Ensure repo.repo_id is a *new global ID* for name_with_owner. */
export async function ensureRepoGhId(
	token: string,
	repoId: number,
): Promise<string> {
	const r = qRepoById.get(repoId);
	if (!r) throw new Error(`Repo not found id=${repoId}`);

	// If already set AND looks like new format (starts with R_kg...), keep it.
	if (r.repo_id && /^R_kg/.test(r.repo_id)) return r.repo_id;

	const [owner, name] = r.name_with_owner.split("/");
	const data = await githubGraphQL<{ repository: { id: string } }>(
		token,
		Q_REPO_ID,
		{ owner, name },
	);
	const newId = data.repository.id;
	uRepoGhId.run(newId, repoId);
	return newId;
}

/** Push the authoritative set of list IDs for a repo to GitHub. */
export async function updateGhListsForRepo(
	token: string,
	repoGlobalId: string,
	listIds: string[],
): Promise<void> {
	await githubGraphQL(token, M_UPDATE_LISTS_FOR_ITEM, {
		itemId: repoGlobalId,
		listIds,
	});
}

/** Utility: map slugs -> list_id using DB */
export function slugsToGhIds(slugs: string[]): string[] {
	const ids: string[] = [];
	for (const s of slugs) {
		const row = qListIdBySlug.get(s);
		if (!row) continue; // silently skip unknown
		const gh = db
			.query<{ list_id: string | null }, [number]>(
				`SELECT list_id FROM list WHERE id = ?`,
			)
			.get(row.id)?.list_id;
		if (gh) ids.push(gh);
	}
	return ids;
}

function parseTopics(json: string | null): string[] {
	if (!json) return [];
	try {
		const v = JSON.parse(json);
		return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function fmtScore(n: number): string {
	return n.toFixed(2);
}

function printReport(
	repo: RepoRow,
	lists: ListDef[],
	current: string[],
	scores: { list: string; score: number; why?: string }[],
) {
	const mapName: Record<string, string> = Object.fromEntries(
		lists.map((l) => [l.slug, l.name]),
	);
	const { top, add, remove, keep, review } = diffMembership(current, scores);

	console.log(`\n▶ ${repo.name_with_owner}`);
	console.log(`   URL    : ${repo.url}`);
	console.log(`   Lang   : ${repo.primary_language ?? "-"}`);
	console.log(
		`   Topics : ${parseTopics(repo.topics).slice(0, 8).join(", ") || "-"}`,
	);
	console.log(
		`   Lists (current): ${current.length ? current.join(", ") : "-"}`,
	);
	console.log(`   Summary: ${repo.summary}`);

	console.log("\n   Top predictions:");
	for (const t of top) {
		const name = mapName[t.list] ?? t.list;
		console.log(
			`     - ${name} (${t.list}): ${fmtScore(t.score)}${t.why ? ` - ${t.why}` : ""}`,
		);
	}

	if (add.length) {
		console.log("\n   Suggest ADD:");
		for (const a of add)
			console.log(`     + ${mapName[a.list] ?? a.list} (${fmtScore(a.score)})`);
	}
	if (remove.length) {
		console.log("\n   Suggest REMOVE:");
		for (const r of remove)
			console.log(`     - ${mapName[r.list] ?? r.list} (${fmtScore(r.score)})`);
	}
	if (review.length) {
		console.log("\n   Review (ambiguous):");
		for (const r of review)
			console.log(`     ? ${mapName[r.list] ?? r.list} (${fmtScore(r.score)})`);
	}

	console.log("\n");
}

async function main() {
	initSchema(); // ensure tables exist (no schema change needed for review-only)
	const input = Bun.argv[2];
	if (!input) {
		console.error("Usage: bun run src/lib/score_one.ts <owner/repo | id:123>");
		process.exit(1);
	}

	let repo: RepoRow | null = null;
	if (input.startsWith("id:")) {
		const id = Number(input.slice(3));
		if (!Number.isFinite(id)) throw new Error("Invalid id");
		repo = qRepoById.get(id);
	} else {
		repo = qRepoByName.get(input);
	}
	if (!repo) throw new Error("Repo not found in DB. Ingest first.");

	const listsRows = qLists.all();
	const lists: ListDef[] = listsRows.map((l) => ({
		slug: l.slug,
		name: l.name,
		description: l.description ?? undefined,
	}));
	const currentRows = qCurrentMembership.all(repo.id);
	const current = currentRows.map((r) => r.slug);

	const facts: RepoFacts = {
		nameWithOwner: repo.name_with_owner,
		url: repo.url,
		summary: repo.summary ?? undefined,
		description: repo.description ?? undefined,
		primaryLanguage: repo.primary_language ?? undefined,
		topics: parseTopics(repo.topics),
	};

	const svc = new OllamaService(Bun.env.OLLAMA_MODEL ?? "");
	const result = await scoreRepoAgainstLists(svc, lists, facts);

	printReport(repo, lists, current, result.scores);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
