// src/lib/types/lists.ts
// List-related types

import type { BaseRow } from "./base";
import type { RepoInfo } from "./repo";

export type StarList = {
	listId: string;
	name: string;
	description?: string | null;
	isPrivate: boolean;
	repos: RepoInfo[];
};

/** List definition metadata */
export type ListDef = {
	slug: string;
	name: string;
	description?: string | null;
};

/** Database row for list definitions */
export type ListDefRow = ListDef;

/** Database row for list membership tracking */
export type ListMembershipRow = BaseRow & {
	repo_id: number;
	list_slug: string;
};
