import type { IndexEntry } from "@src/types";

export type IngestReporter = {
	/** Called after index.json is read & validated */
	start?: (totalLists: number) => void;
	/** Called before importing a list */
	listStart?: (
		meta: IndexEntry,
		index: number, // 0-based
		total: number,
		repoCount: number,
	) => void;
	/** Called after a list (and all repos) are upserted */
	listDone?: (meta: IndexEntry, repoCount: number) => void;
	/** Called after all work is done */
	done?: (summary: { lists: number; repos: number }) => void;
};
