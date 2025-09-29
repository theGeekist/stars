import type { BatchSelector, RepoRow, StarList } from "@lib/types";

// Re-export commonly used types
export type { RepoRow, BatchSelector, StarList };

export type ListDef = {
	slug: string;
	name: string;
	description?: string | null;
};

export type ListsReadApi = {
	getAll(): Promise<StarList[]>;
	getAllStream(): AsyncGenerator<StarList, void, void>;
	getListDefs(): Promise<
		Array<{ slug: string; name: string; description?: string | null }>
	>;
	getReposToScore(sel: BatchSelector): Promise<RepoRow[]>;
	currentMembership(repoId: number): Promise<string[]>;
	mapSlugsToGhIds(slugs: string[]): Promise<string[]>;
};

export type ListsApplyApi = {
	reconcileLocal(repoId: number, slugs: string[]): Promise<void>;
	updateOnGitHub(
		token: string,
		repoGlobalId: string,
		listIds: string[],
	): Promise<void>;
	ensureListGhIds(token: string): Promise<Map<string, string>>; // slug -> GH id
	ensureRepoGhId(token: string, repoId: number): Promise<string>; // returns GH id
};

export type ListsService = {
	read: ListsReadApi;
	apply: ListsApplyApi;
};

/** Binds */
export type BindLimit = [limit: number];
export type BindSlugLimit = [slug: string, limit: number];

/** Local row-shapes for queries that don't match full RepoRow */
export type ListSlugRow = { slug: string };
export type ListIdRow = { id: string };
export type ListListIdRow = { list_id: string | null };
export type ListDefRow = {
	slug: string;
	name: string;
	description: string | null;
};

/** Repo row for GH id fetch: allow repo_id to be NULL in DB before we backfill */
export type RepoIdLookupRow = {
	id: string;
	repo_id: string | null;
	name_with_owner: string;
	url: string;
	description: string | null;
	primary_language: string | null;
	topics: string | null;
	summary: string | null;
};

/** Row placeholder for statements where we don't read rows (INSERT/UPDATE/DELETE) */
export type NoRow = Record<string, never>;

/** Additional row types for database operations */
export type ListedRepoIdRow = {
	repo_id: string; // GitHub global ID
};

export type ListKeyIdRow = {
	id: string;
	slug: string;
	name: string;
};

/** GraphQL response node types */
export type ListEdge = {
	cursor: string;
	node: ListNode;
};

export type ListNode = {
	listId: string;
	name: string;
	description?: string | null;
	isPrivate: boolean;
};

export type ListNodeWithItems = {
	name: string;
	items: {
		pageInfo: { endCursor: string | null; hasNextPage: boolean };
		nodes: ItemNode[];
	};
};

export type ItemNode = {
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
};
