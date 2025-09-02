// src/lib/score_one.ts

import { createListsService } from "@features/lists";
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";
import { db, initSchema } from "@lib/db";
import { createLogger } from "@lib/logger";
import {
	type ListDef,
	type RepoFacts,
	scoreRepoAgainstLists,
} from "@lib/score";
import type { RepoRow } from "@lib/types";

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
	// Use feature scoring thresholds for consistent suggestions
	const scoring = createScoringService();
	const plan = scoring.planTargets(current, scores, DEFAULT_POLICY.thresholds);
	const sorted = [...scores].sort((a, b) => b.score - a.score);
	const top = sorted.slice(0, 3);
	const { add, remove, review } = plan;
	const scoreMap = new Map<string, number>(
		scores.map((s) => [s.list, s.score]),
	);

	const log = createLogger();
	log.header(repo.name_with_owner);
	log.info(`URL    : ${repo.url}`);
	log.info(`Lang   : ${repo.primary_language ?? "-"}`);
	log.info(
		`Topics : ${parseTopics(repo.topics).slice(0, 8).join(", ") || "-"}`,
	);
	log.info(`Lists (current): ${current.length ? current.join(", ") : "-"}`);
	log.info(`Summary: ${repo.summary}`);

	log.info("\nTop predictions:");
	for (const t of top) {
		const name = mapName[t.list] ?? t.list;
		log.info(
			`- ${name} (${t.list}): ${fmtScore(t.score)}${t.why ? ` - ${t.why}` : ""}`,
		);
	}

	if (add.length) {
		log.info("\nSuggest ADD:");
		for (const slug of add) {
			const name = mapName[slug] ?? slug;
			log.info(`+ ${name} (${fmtScore(scoreMap.get(slug) ?? 0)})`);
		}
	}
	if (remove.length) {
		log.info("\nSuggest REMOVE:");
		for (const slug of remove) {
			const name = mapName[slug] ?? slug;
			log.info(`- ${name} (${fmtScore(scoreMap.get(slug) ?? 0)})`);
		}
	}
	if (review.length) {
		log.info("\nReview (ambiguous):");
		for (const slug of review) {
			const name = mapName[slug] ?? slug;
			log.info(`? ${name} (${fmtScore(scoreMap.get(slug) ?? 0)})`);
		}
	}
	log.line("\n");
}

async function main() {
	initSchema(); // ensure tables exist (no schema change needed for review-only)
	const input = Bun.argv[2];
	if (!input) {
		createLogger().error(
			"Usage: bun run src/lib/score_one.ts <owner/repo | id:123>",
		);
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

	const result = await scoreRepoAgainstLists(lists, facts);

	printReport(repo, lists, current, result.scores);
}

if (import.meta.main) {
	main().catch((e) => {
		const log = createLogger();
		log.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	});
}
