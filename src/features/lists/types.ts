import type { RepoRow, StarList } from "../../lib/types";

export type BatchSelector = { limit?: number; listSlug?: string };

export type ListsReadApi = {
  getAll(): Promise<StarList[]>;
  getAllStream(): AsyncGenerator<StarList, void, void>;
  getListDefs(): Promise<Array<{ slug: string; name: string; description?: string | null }>>;
  getReposToScore(sel: BatchSelector): Promise<RepoRow[]>;
  currentMembership(repoId: number): Promise<string[]>;
  mapSlugsToGhIds(slugs: string[]): Promise<string[]>;
};

export type ListsApplyApi = {
  reconcileLocal(repoId: number, slugs: string[]): Promise<void>;
  updateOnGitHub(token: string, repoGlobalId: string, listIds: string[]): Promise<void>;
  ensureListGhIds(token: string): Promise<Map<string, string>>; // slug -> GH id
  ensureRepoGhId(token: string, repoId: number): Promise<string>; // returns GH id
};

export type ListsService = {
  read: ListsReadApi;
  apply: ListsApplyApi;
};
