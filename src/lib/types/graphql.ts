// src/lib/types/graphql.ts
// Common GraphQL response patterns

import type { PageInfo } from "./base";

/** Common edge pattern for GraphQL responses */
export type Edge<T> = {
	cursor: string;
	node: T;
};

/** Common connection pattern for GraphQL responses */
export type Connection<T> = {
	pageInfo: PageInfo;
	edges: Edge<T>[];
};

/** Star edge from GitHub stars API */
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
		watchers?: { totalCount: number };
		issues?: { totalCount: number };
		pullRequests?: { totalCount: number };
		defaultBranchRef?: {
			name?: string | null;
			target?: {
				committedDate?: string;
				history?: {
					nodes?: Array<{
						committedDate?: string | null;
						messageHeadline?: string | null;
					}>;
				};
			} | null;
		} | null;
		primaryLanguage?: { name?: string | null } | null;
		languages?: {
			edges?: Array<{ size?: number | null; node?: { name?: string } | null }>;
		} | null;
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
		releases?: {
			nodes?: Array<{
				tagName?: string | null;
				publishedAt?: string | null;
				url?: string | null;
			}>;
		} | null;
		hasDiscussionsEnabled?: boolean;
		discussionCategories?: {
			nodes?: Array<{
				id: string;
				name: string;
				slug?: string | null;
			}>;
		} | null;
		changelogRoot?: {
			__typename?: string;
			byteSize?: number | null;
			oid?: string | null;
		} | null;
		changelogDocs?: {
			__typename?: string;
			byteSize?: number | null;
			oid?: string | null;
		} | null;
		changelogHistory?: {
			__typename?: string;
			byteSize?: number | null;
			oid?: string | null;
		} | null;
		changelogChanges?: {
			__typename?: string;
			byteSize?: number | null;
			oid?: string | null;
		} | null;
		changelogNews?: {
			__typename?: string;
			byteSize?: number | null;
			oid?: string | null;
		} | null;
	};
};

/** Lists response patterns */
export type ListsEdgesPage = {
	viewer: {
		lists: {
			pageInfo: PageInfo;
			edges: Edge<{
				listId: string;
				name: string;
				description?: string | null;
				isPrivate: boolean;
			}>[];
		};
	};
};

export type ListItemsAtEdge = {
	viewer: {
		lists: {
			nodes: Array<{
				name: string;
				items: {
					pageInfo: PageInfo;
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
								url?: string | null;
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
						hasDiscussionsEnabled?: boolean;
						discussionCategories?: {
							nodes: Array<{
								id: string;
								name: string;
								slug?: string | null;
							}>;
						};
						changelogRoot?: {
							__typename?: string;
							byteSize?: number | null;
							oid?: string | null;
						} | null;
						changelogDocs?: {
							__typename?: string;
							byteSize?: number | null;
							oid?: string | null;
						} | null;
						changelogHistory?: {
							__typename?: string;
							byteSize?: number | null;
							oid?: string | null;
						} | null;
						changelogChanges?: {
							__typename?: string;
							byteSize?: number | null;
							oid?: string | null;
						} | null;
						changelogNews?: {
							__typename?: string;
							byteSize?: number | null;
							oid?: string | null;
						} | null;
					}>;
				};
			}>;
		};
	};
};

export type ViewerStarIds = {
	viewer: {
		starredRepositories: {
			pageInfo: PageInfo;
			edges: Edge<{
				id: string;
				nameWithOwner: string;
			}>[];
		};
	};
};
