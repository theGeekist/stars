export type RepoInfo = {
	repoId: string;
	nameWithOwner: string;
	url: string;
	description?: string | null;
	homepageUrl?: string | null;
	stars: number;
	forks: number;
	watchers: number;
	openIssues: number;
	openPRs: number;
	defaultBranch?: string | null;
	lastCommitISO?: string | boolean;
	lastRelease?: { tagName?: string | null; publishedAt?: string | null } | null;
	topics: string[];
	primaryLanguage?: string | null;
	languages: { name: string; bytes: number }[];
	license?: string | null;
	isArchived: boolean;
	isDisabled: boolean;
	isFork: boolean;
	isMirror: boolean;
	hasIssuesEnabled: boolean;
	pushedAt: string;
	updatedAt: string;
	createdAt: string;
	diskUsage?: number | null;
};

export type StarList = {
	listId: string;
	name: string;
	description?: string | null;
	isPrivate: boolean;
	repos: RepoInfo[];
};

export type ListsEdgesPage = {
	viewer: {
		lists: {
			pageInfo: { endCursor: string | null; hasNextPage: boolean };
			edges: Array<{
				cursor: string;
				node: {
					listId: string;
					name: string;
					description?: string | null;
					isPrivate: boolean;
				};
			}>;
		};
	};
};

export type ListItemsAtEdge = {
	viewer: {
		lists: {
			nodes: Array<{
				name: string;
				items: {
					pageInfo: { endCursor: string | null; hasNextPage: boolean };
					nodes: Array<{
						__typename: "Repository";
						repoId: string;
						nameWithOwner?: string;
						url?: string;
						description?: string | null;
						homepageUrl?: string | null;

						stargazerCount?: number;
						forkCount?: number;
						watchers?: { totalCount: number };

						issues?: { totalCount: number };
						pullRequests?: { totalCount: number };

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

						repositoryTopics?: { nodes: Array<{ topic: { name: string } }> };
						primaryLanguage?: { name: string } | null;
						languages?: {
							edges: Array<{ size: number; node: { name: string } }>;
						};

						licenseInfo?: { spdxId?: string | null } | null;

						isArchived?: boolean;
						isDisabled?: boolean;
						isFork?: boolean;
						isMirror?: boolean;
						hasIssuesEnabled?: boolean;

						pushedAt?: string;
						updatedAt?: string;
						createdAt?: string;

						diskUsage?: number | null;
					}>;
				};
			}>;
		};
	};
};

export type ViewerStarIds = {
	viewer: {
		starredRepositories: {
			pageInfo: { endCursor: string | null; hasNextPage: boolean };
			edges: Array<{
				node: {
					id: string;
					nameWithOwner: string;
				};
			}>;
		};
	};
};

export type ChunkingOptions = {
	chunkSizeTokens?: number;
	chunkOverlapTokens?: number;
	mode?: "sentence" | "token";
};
// --- typed statements --------------------------------------------------------
export type ReadmeRow = {
	id: number;
	readme_md: string | null;
	readme_etag: string | null;
};
export type RepoRow = {
	id: number;
	repo_id: string;
	name_with_owner: string;
	url: string;
	description: string | null;
	primary_language: string | null;
	license: string | null;
	tags: string | null;
	summary: string | null;
	is_archived: number;
	is_disabled: number;
	popularity: number | null;
	freshness: number | null;
	activeness: number | null;
	updated_at: string | null;
	topics: string | null; // JSON text
	stars: number | null;
	forks: number | null;
};

// Topic-related types now live under src/features/topics/types.ts
// ────────────────────────────── config + logging ───────────────────────────
export type ListsConfig = {
	pageSize: number;
	concurrency: number;
	debug: boolean;
}; // --- fetch + cache -----------------------------------------------------------
/**
 * Fetch README with ETag caching and persist:
 * - 200: save (readme_md, readme_etag, readme_fetched_at)
 * - 304: keep readme_md/etag, update readme_fetched_at
 * - 404: return null (no update)
 * - other errors: log & return cached; bump fetched_at so we know we tried
 */
export type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;
/* ──────────────────────── mapping ────────────────────────── */
export type StarEdge = {
	starredAt: string;
	node: {
		id: string;
		nameWithOwner: string;
		url: string;
		description?: string | null;
		homepageUrl?: string | null;
		stargazerCount?: number;
		forkCount?: number;
		issues?: { totalCount: number };
		pullRequests?: { totalCount: number };
		defaultBranchRef?: {
			name?: string | null;
			target?: { committedDate?: string } | null;
		} | null;
		primaryLanguage?: { name?: string | null } | null;
		licenseInfo?: { spdxId?: string | null } | null;
		isArchived?: boolean;
		isDisabled?: boolean;
		isFork?: boolean;
		isMirror?: boolean;
		hasIssuesEnabled?: boolean;
		pushedAt?: string;
		updatedAt?: string;
		createdAt?: string;
		repositoryTopics?: {
			nodes?: Array<{ topic?: { name?: string | null } | null } | null>;
		} | null;
	};
};

export type GhExec = (
	token: string,
	queryOrDoc: string | { query?: string; doc?: string },
	vars?: Record<string, unknown>,
) => Promise<unknown>;
