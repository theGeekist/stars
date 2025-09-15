import type { RepoInfo } from "@lib/types";

export type BatchSelector = { limit?: number };

export type RepoRow = {
	id: number;
	repo_id: string | null; // GH node id (e.g., R_kg...)
	name_with_owner: string;
	url: string;
	description: string | null;
	primary_language: string | null;
	topics: string[] | null;
	stars: number | null;
	forks: number | null;
	popularity: number | null;
	freshness: number | null;
	activeness: number | null;
	pushed_at: string | null;
	last_commit_iso: string | null;
	last_release_iso: string | null;
	updated_at: string | null;
	summary: string | null;
};

export type StarsService = {
	read: {
		/** Fetch all starred repos from GitHub (network). */
		getAll: () => Promise<RepoInfo[]>;
		/** Stream starred repos from GitHub in pages (network). */
		getAllStream: () => AsyncGenerator<RepoInfo[], void, void>;
		/** Set of GH node IDs for all your stars (network). */
		collectStarIdsSet: () => Promise<Set<string>>;
		/** Set of GH node IDs for all repos that are currently in any list (local DB). */
		collectLocallyListedRepoIdsSet: () => Promise<Set<string>>;
		/** Convenience: RepoInfo[] for stars that are not in any local list (network + local DB). */
		getUnlistedStars: (signal?: AbortSignal) => Promise<RepoInfo[]>;
		/** Optional: fetch a sample from DB, similar to lists’ getReposToScore. */
		getReposToScore: (sel: BatchSelector) => Promise<RepoRow[]>;
	};
};
