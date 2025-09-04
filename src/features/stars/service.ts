// src/features/stars/service.ts
import type { Database } from "bun:sqlite";
import { withDB } from "@lib/db";
import { githubGraphQL } from "@lib/github";
import {
	collectStarIdsSet as _collectStarIdsSet,
	getAllStars as _getAllStars,
	getAllStarsStream as _getAllStarsStream,
} from "@lib/stars";
import type { RepoInfo } from "@lib/types";
import type { BatchSelector, RepoRow, StarsService } from "./types";

type Deps = {
	token?: string;
	getAllStars?: typeof _getAllStars;
	getAllStarsStream?: typeof _getAllStarsStream;
	collectStarIdsSet?: typeof _collectStarIdsSet;
};

/** Construct a StarsService with explicit DB, GH runner, and optional DI. */
export function createStarsService(
	database?: Database,
	ghGraphQL: <T>(
		token: string,
		query: string,
		vars?: Record<string, unknown>,
	) => Promise<T> = githubGraphQL,
	deps: Deps = {},
): StarsService {
	const db = withDB(database);

	// one-time resolution; tests can inject these
	const token = deps.token ?? Bun.env.GITHUB_TOKEN ?? "";
	const getAllStars = deps.getAllStars ?? _getAllStars;
	const getAllStarsStream = deps.getAllStarsStream ?? _getAllStarsStream;
	const collectStarIdsSet = deps.collectStarIdsSet ?? _collectStarIdsSet;

	// ────────────────────────────── DB reads ──────────────────────────────
	const qReposDefault = db.query<RepoRow, [number]>(`
    SELECT id, name_with_owner, url, description, primary_language, topics,
           stars, forks, popularity, freshness, activeness,
           pushed_at, last_commit_iso, last_release_iso, updated_at, summary
    FROM repo
    ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
    LIMIT ?
  `);

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
		if (!token) throw new Error("Missing GITHUB_TOKEN");

		// Stream stars and flatten
		const stars: RepoInfo[] = [];
		for await (const page of getAllStarsStream(token, ghGraphQL)) {
			stars.push(...page);
		}

		// diff vs locally listed repo node IDs
		const listed = await collectLocallyListedRepoIdsSet();
		const out: RepoInfo[] = [];
		for (const r of stars) {
			if (!r.repoId) continue;
			if (!listed.has(r.repoId)) out.push(r);
		}
		return out;
	}

	return {
		read: {
			getAll: () => getAllStars(token, ghGraphQL),
			getAllStream: () => getAllStarsStream(token, ghGraphQL),
			collectStarIdsSet: () => collectStarIdsSet(token, ghGraphQL),

			collectLocallyListedRepoIdsSet,
			getUnlistedStars,
			getReposToScore,
		},
	};
}
