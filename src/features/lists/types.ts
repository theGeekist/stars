import type { RepoRow, StarList } from "@lib/types";

export type BatchSelector = { limit?: number; listSlug?: string };

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
export type BindSlugLimit = [
	slug: string,
	limit: number,
]; /** Local row-shapes for queries that don’t match full RepoRow */
export type ListSlugRow = { slug: string };
export type ListIdRow = { id: number };
export type ListListIdRow = { list_id: string | null };
export type ListDefRow = {
	slug: string;
	name: string;
	description: string | null;
};
/** Repo row for GH id fetch: allow repo_id to be NULL in DB before we backfill */
export type RepoIdLookupRow = {
	id: number;
	repo_id: string | null;
	name_with_owner: string;
	url: string;
	description: string | null;
	primary_language: string | null;
	topics: string | null;
	summary: string | null;
};
/** Row placeholder for statements where we don’t read rows (INSERT/UPDATE/DELETE) */
export type NoRow = Record<string, never>;
