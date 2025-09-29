// src/lib/types/database.ts
// Database row and query result types

/** Generic row type for statements that don't return rows */
export type NoRow = Record<string, never>;

/** Generic ID row types */
export type IdRow = { id: number };
export type StringIdRow = { id: string };

/** Common database bind parameter patterns */
export type BindLimit = [limit: number];
export type BindSlugLimit = [slug: string, limit: number];
export type BindIdLimit = [id: number, limit: number];

/** Common lookup row patterns */
export type SlugRow = { slug: string };
export type NameRow = { name: string };
export type UrlRow = { url: string };

/** List-specific row types */
export type ListSlugRow = { slug: string };
export type ListIdRow = { id: string };
export type ListListIdRow = { list_id: string | null };

/** Repository lookup rows */
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

export type ListedRepoIdRow = {
	repo_id: string; // GitHub global ID
};

export type ListKeyIdRow = {
	id: string;
	slug: string;
	name: string;
};
