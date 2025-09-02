// src/lib/score_one.ts
import { OllamaService } from "@jasonnathan/llm-core";
import { scoreRepoAgainstLists, type ListDef, type RepoFacts } from "./score";
import { initSchema, db } from "./db";
import type { RepoRow } from "./types";
import { createListsService } from "../features/lists";

type ListRow = { slug: string; name: string; description: string | null };
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
	// Minimal in-file view; planning in batch CLI via Scoring service
	const sorted = [...scores].sort((a, b) => b.score - a.score);
	const top = sorted.slice(0, 3);
	const add = sorted.filter((s) => s.score >= 0.7 && !current.includes(s.list));
	const remove = sorted.filter((s) => s.score <= 0.3 && current.includes(s.list));
	const keep = sorted.filter((s) => s.score > 0.3 && current.includes(s.list));
	const review = sorted.filter(
		(s) => !current.includes(s.list) && s.score > 0.3 && s.score < 0.7,
	);

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

    const listsSvc = createListsService();
    const listsRows = await listsSvc.read.getListDefs();
    const lists: ListDef[] = listsRows.map((l) => ({
        slug: l.slug,
        name: l.name,
        description: l.description ?? undefined,
    }));
    const current = await listsSvc.read.currentMembership(repo.id);

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
