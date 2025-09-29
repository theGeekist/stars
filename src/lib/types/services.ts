// src/lib/types/services.ts
// Service interface types

import type { BatchSelector } from "./base";
import type { StarList } from "./lists";
import type { RepoRow } from "./repo";

/** Read-only operations for lists */
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

/** Write operations for lists */
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

/** Complete lists service interface */
export type ListsService = {
	read: ListsReadApi;
	apply: ListsApplyApi;
};
