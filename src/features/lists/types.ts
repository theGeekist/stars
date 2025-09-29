import type {
	BatchSelector,
	BindLimit,
	BindSlugLimit,
	GitHubRepoFields,
	ListDef,
	ListedRepoIdRow,
	ListIdRow,
	ListKeyIdRow,
	ListListIdRow,
	ListSlugRow,
	ListsApplyApi,
	ListsReadApi,
	ListsService,
	NoRow,
	RepoIdLookupRow,
	RepoRow,
	StarList,
} from "@lib/types";

// Re-export commonly used types
export type {
	RepoRow,
	BatchSelector,
	StarList,
	ListDef,
	ListsReadApi,
	ListsApplyApi,
	ListsService,
	BindLimit,
	BindSlugLimit,
	NoRow,
	ListSlugRow,
	ListIdRow,
	ListListIdRow,
	RepoIdLookupRow,
	ListedRepoIdRow,
	ListKeyIdRow,
};

/** Feature-specific list definition row (with non-null description) */
export type ListDefRow = {
	slug: string;
	name: string;
	description: string | null;
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
} & GitHubRepoFields;
