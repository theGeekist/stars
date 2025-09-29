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

/** Core repository identification fields */
export type CoreRepoFields = {
	nameWithOwner?: string;
	url?: string;
	description?: string | null;
	homepageUrl?: string | null;
};

/** Repository statistics fields */
export type RepoStatsFields = {
	stargazerCount?: number;
	forkCount?: number;
	watchers?: { totalCount: number };
	issues?: { totalCount: number };
	pullRequests?: { totalCount: number };
};

/** Repository metadata fields */
export type RepoMetaFields = {
	primaryLanguage?: { name: string } | null;
	languages?: {
		edges: Array<{ size: number; node: { name: string } }>;
	};
	licenseInfo?: { spdxId?: string | null } | null;
	repositoryTopics?: { nodes: Array<{ topic: { name: string } }> };
};

/** Repository status fields */
export type RepoStatusFields = {
	isArchived?: boolean;
	isDisabled?: boolean;
	isFork?: boolean;
	isMirror?: boolean;
	hasIssuesEnabled?: boolean;
};

/** Repository timestamps */
export type RepoTimestampFields = {
	pushedAt?: string;
	updatedAt?: string;
	createdAt?: string;
};

/** Complete GitHub repository fields composition */
export type GitHubRepoFields = CoreRepoFields &
	RepoStatsFields &
	RepoMetaFields &
	RepoStatusFields &
	RepoTimestampFields & {
		defaultBranchRef?: {
			name?: string | null;
			target?: { committedDate?: string | null } | null;
		} | null;
		releases?: {
			nodes: Array<{
				tagName?: string | null;
				publishedAt?: string | null;
			}>;
		};
		diskUsage?: number | null;
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
