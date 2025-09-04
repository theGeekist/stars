// src/features/stars/service.ts
import type { Database } from "bun:sqlite";
import { withDB } from "@lib/db";
import { githubGraphQL } from "@lib/github";
import { collectStarIdsSet, getAllStars, getAllStarsStream } from "@lib/stars";
import type { RepoInfo } from "@lib/types";
import type { BatchSelector, RepoRow, StarsService } from "./types";

/** Construct a StarsService with an explicit DB and GH runner (both injectable for tests). */
export function createStarsService(
	database?: Database,
	ghGraphQL: <T>(
		token: string,
		query: string,
		vars?: Record<string, unknown>,
	) => Promise<T> = githubGraphQL,
): StarsService {
	const db = withDB(database);

	// ────────────────────────────── DB reads ──────────────────────────────
	const qReposDefault = db.query<RepoRow, [number]>(`
    SELECT id, name_with_owner, url, description, primary_language, topics,
           stars, forks, popularity, freshness, activeness,
           pushed_at, last_commit_iso, last_release_iso, updated_at, summary
    FROM repo
    ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
    LIMIT ?
  `);

	// Distinct GitHub node IDs for repos that are currently in any local list
	const qListedRepoNodeIds = db.query<{ repo_id: string | null }, []>(`
    SELECT DISTINCT r.repo_id
    FROM repo r
    JOIN list_repo lr ON lr.repo_id = r.id
    WHERE r.repo_id IS NOT NULL
  `);

	async function getReposToScore(sel: BatchSelector): Promise<RepoRow[]> {
		const limit = Math.max(1, Number(sel.limit ?? 10));
		return qReposDefault.all(limit);
	}

	async function collectLocallyListedRepoIdsSet(): Promise<Set<string>> {
		const rows = qListedRepoNodeIds.all();
		const s = new Set<string>();
		for (const r of rows) if (r.repo_id) s.add(r.repo_id);
		return s;
	}

	// ─────────────────────────── Cross-source diff ─────────────────────────
	async function getUnlistedStars(): Promise<RepoInfo[]> {
		const token = Bun.env.GITHUB_TOKEN ?? "";
		if (!token) throw new Error("Missing GITHUB_TOKEN");

		// Stream stars from GitHub (via injected GH runner) and flatten
		const stars: RepoInfo[] = [];
		for await (const page of getAllStarsStream(token, ghGraphQL)) {
			stars.push(...page);
		}

		// Compute set difference vs locally listed repo node IDs
		const listed = await collectLocallyListedRepoIdsSet();
		const out: RepoInfo[] = [];
		for (const r of stars) {
			if (!r.repoId) continue; // defensive: require node id for diffing
			if (!listed.has(r.repoId)) out.push(r);
		}
		return out;
	}

	return {
		read: {
			// direct GH pulls (use injected runner)
			getAll: () => getAllStars(Bun.env.GITHUB_TOKEN ?? "", ghGraphQL),
			getAllStream: () =>
				getAllStarsStream(Bun.env.GITHUB_TOKEN ?? "", ghGraphQL),
			collectStarIdsSet: () =>
				collectStarIdsSet(Bun.env.GITHUB_TOKEN ?? "", ghGraphQL),

			// local helpers / cross-source
			collectLocallyListedRepoIdsSet,
			getUnlistedStars,

			// parity helper for pipelines
			getReposToScore,
		},
	};
}
