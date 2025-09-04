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

type StarsOpts = { token?: string };

export function createStarsService(
	database?: Database,
	ghGraphQLParam: <T>(
		token: string,
		query: string,
		vars?: Record<string, unknown>,
	) => Promise<T> = githubGraphQL,
	opts?: StarsOpts,
): StarsService {
	const db = withDB(database);

	// Resolve once; tests can inject
	const token = opts?.token ?? Bun.env.GITHUB_TOKEN ?? "";

	// DB queries (unchanged)
	const qReposDefault = db.query<RepoRow, [number]>(/* sql */ `
    SELECT id, name_with_owner, url, description, primary_language, topics,
           stars, forks, popularity, freshness, activeness,
           pushed_at, last_commit_iso, last_release_iso, updated_at, summary
    FROM repo
    ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
    LIMIT ?
  `);

	const qListedRepoNodeIds = db.query<
		{ repo_id: string | null },
		[]
	>(/* sql */ `
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

	// Cross-source diff (stars vs locally listed)
	async function getUnlistedStars(): Promise<RepoInfo[]> {
		// If you want to *require* a token, re-enable this guard:
		// if (!token) throw new Error("Missing GITHUB_TOKEN");

		const stars: RepoInfo[] = [];
		for await (const page of _getAllStarsStream(token, ghGraphQLParam)) {
			stars.push(...page);
		}

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
			getAll: () => _getAllStars(token, ghGraphQLParam),
			getAllStream: () => _getAllStarsStream(token, ghGraphQLParam),
			collectStarIdsSet: () => _collectStarIdsSet(token, ghGraphQLParam),

			collectLocallyListedRepoIdsSet,
			getUnlistedStars,
			getReposToScore,
		},
	};
}
