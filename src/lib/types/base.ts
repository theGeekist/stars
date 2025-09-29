// src/lib/types/base.ts
// Core base types that all features can extend from

/** Common pagination and selection patterns */
export type BatchSelector = {
	limit?: number;
	listSlug?: string;
};

/** Common database row identifier patterns */
export type BaseRow = {
	id: number;
};

/** ISO date string format */
export type ISODateTime = string;

/** Common GitHub repository identifiers */
export type RepoIdentifiers = {
	repo_id: string;
	name_with_owner: string;
	url: string;
};

/** Base repo metadata shared across all repo representations */
export type BaseRepoMeta = {
	description?: string | null;
	primary_language?: string | null;
	topics?: string | string[] | null; // JSON string in DB, array in memory
	stars?: number | null;
	forks?: number | null;
	updated_at?: string | null;
};

/** Standard CLI command options */
export type BaseCliOptions = {
	json?: boolean;
	out?: string;
	dry?: boolean;
};

/** Common GraphQL pagination pattern */
export type PageInfo = {
	endCursor: string | null;
	hasNextPage: boolean;
};

/** Common GitHub node pattern */
export type GitHubNode = {
	id: string;
	url?: string;
};
