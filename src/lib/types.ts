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

export type RepoRef = { owner: string; name: string };

export type TopicRow = {
	topic: string;
	display_name?: string | null;
	short_description?: string | null;
	aliases_json?: string | null; // JSON.stringify(string[])
	is_featured: 0 | 1;
	updated_at: string; // ISO
	etag?: string | null;
};

export type RepoTopicLink = {
	repo_id: number;
	topic: string;
	added_at: string; // ISO
};
export type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;
