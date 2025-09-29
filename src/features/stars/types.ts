import type { BatchSelector, RepoInfo, RepoRow } from "@lib/types";

// Re-export types used by service
export type { BatchSelector, RepoInfo, RepoRow };

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
