// src/features/lists/services.spec.ts
import { describe, expect, it } from "bun:test";
import {
	fetchListItems,
	getUnlistedStarsFromGh,
	LIST_ITEMS_AT_EDGE,
	LISTS_EDGES_PAGE,
	M_UPDATE_LISTS_FOR_ITEM,
	streamListsEdges,
	streamViewerStars,
	updateRepoListsOnGitHub,
	VIEWER_STAR_IDS,
} from "@features/lists/services";
import type { GhExec, ListItemsAtEdge, ListsEdgesPage } from "@lib/types";
import { makeFakeGh } from "@src/__test__/github-fakes";

/* ───────────── fixtures ───────────── */

const page1: ListsEdgesPage = {
	viewer: {
		lists: {
			pageInfo: { endCursor: "EC1", hasNextPage: true },
			edges: [
				{
					cursor: "C0",
					node: {
						listId: "L_A",
						name: "A",
						description: "a",
						isPrivate: false,
					},
				},
				{
					cursor: "C1",
					node: {
						listId: "L_B",
						name: "B",
						description: null,
						isPrivate: false,
					},
				},
			],
		},
	},
};

const page2: ListsEdgesPage = {
	viewer: {
		lists: {
			pageInfo: { endCursor: null, hasNextPage: false },
			edges: [
				{
					cursor: "C2",
					node: { listId: "L_C", name: "C", description: "c", isPrivate: true },
				},
			],
		},
	},
};

const itemsAtEdge_A: ListItemsAtEdge = {
	viewer: {
		lists: {
			nodes: [
				{
					name: "A",
					items: {
						pageInfo: { endCursor: null, hasNextPage: false },
						nodes: [
							{
								__typename: "Repository",
								repoId: "R1",
								nameWithOwner: "o/r1",
								url: "https://x/1",
								description: "d1",
								homepageUrl: null,
								stargazerCount: 10,
								forkCount: 2,
								issues: { totalCount: 3 },
								pullRequests: { totalCount: 4 },
								defaultBranchRef: {
									name: "main",
									target: { committedDate: "2024-01-02T00:00:00Z" },
								},
								primaryLanguage: { name: "TS" },
								licenseInfo: { spdxId: "MIT" },
								isArchived: false,
								isDisabled: false,
								isFork: false,
								isMirror: false,
								hasIssuesEnabled: true,
								pushedAt: "2024-01-03T00:00:00Z",
								updatedAt: "2024-01-04T00:00:00Z",
								createdAt: "2023-01-01T00:00:00Z",
								repositoryTopics: {
									nodes: [{ topic: { name: "x" } }, { topic: { name: "y" } }],
								},
							},
						],
					},
				},
			],
		},
	},
};

const itemsAtEdge_B_empty: ListItemsAtEdge = {
	viewer: {
		lists: {
			nodes: [
				{
					name: "B",
					items: {
						pageInfo: { endCursor: null, hasNextPage: false },
						nodes: [],
					},
				},
			],
		},
	},
};

const itemsAtEdge_C_empty: ListItemsAtEdge = {
	viewer: {
		lists: {
			nodes: [
				{
					name: "C",
					items: {
						pageInfo: { endCursor: null, hasNextPage: false },
						nodes: [],
					},
				},
			],
		},
	},
};

const starIdsPage1 = {
	viewer: {
		starredRepositories: {
			pageInfo: { endCursor: "SC1", hasNextPage: true },
			edges: [{ node: { id: "R1", nameWithOwner: "o/r1" } }],
		},
	},
};
const starIdsPage2 = {
	viewer: {
		starredRepositories: {
			pageInfo: { endCursor: null, hasNextPage: false },
			edges: [{ node: { id: "R2", nameWithOwner: "o/r2" } }],
		},
	},
};

/* ───────────── fakes ───────────── */

// ListsEdges paging: page1 → page2, advancing on ListsEdgesPage
const ghEdges = makeFakeGh(
	[{ [LISTS_EDGES_PAGE]: () => page1 }, { [LISTS_EDGES_PAGE]: () => page2 }],
	{ paginateOn: "ListsEdgesPage" },
);

// Items at edge: listAfter semantics → A:null, B:C0, C:C1
const ghItems = makeFakeGh({
	[LIST_ITEMS_AT_EDGE]: (vars?: Record<string, unknown>) => {
		const { listAfter } = vars ?? {};
		if (listAfter == null) return itemsAtEdge_A; // A
		if (listAfter === "C0") return itemsAtEdge_B_empty; // B
		if (listAfter === "C1") return itemsAtEdge_C_empty; // C
		// Fallback: still provide a node to prevent accidental throw
		return {
			viewer: {
				lists: {
					nodes: [
						{
							name: "?",
							items: {
								pageInfo: { endCursor: null, hasNextPage: false },
								nodes: [],
							},
						},
					],
				},
			},
		} satisfies ListItemsAtEdge;
	},
});

// Viewer stars paging
const ghStars = makeFakeGh(
	[
		{ [VIEWER_STAR_IDS]: () => starIdsPage1 },
		{ [VIEWER_STAR_IDS]: () => starIdsPage2 },
	],
	{ paginateOn: "ViewerStarIds" },
);

// Mutations: capture payload
let lastUpdatePayload: { itemId: string; listIds: string[] } | null = null;
const ghMut = makeFakeGh({
	[M_UPDATE_LISTS_FOR_ITEM]: (vars?: Record<string, unknown>) => {
		const itemId = vars?.itemId as string;
		const listIds = (vars?.listIds as string[]) ?? [];
		lastUpdatePayload = { itemId, listIds };
		return {
			updateUserListsForItem: {
				lists: listIds.map((id: string) => ({
					id,
					name: `N_${id}`,
				})),
			},
		};
	},
});

// Convert GhClient to GhExec
const asExec =
	(client: ReturnType<typeof makeFakeGh>): GhExec =>
	(token, queryOrDoc, vars) => {
		const query =
			typeof queryOrDoc === "string"
				? queryOrDoc
				: (queryOrDoc.query ?? queryOrDoc.doc ?? "");
		return client(token, query, vars);
	};

const ghEdgesExec = asExec(ghEdges);
const ghItemsExec = asExec(ghItems);
const ghStarsExec = asExec(ghStars);
const ghMutExec = asExec(ghMut);

/** Merged exec that routes by operation (used by getAllListsStream end-to-end) */
const _mergedExec: GhExec = (token, queryOrDoc, vars) => {
	const s =
		typeof queryOrDoc === "string"
			? queryOrDoc
			: (queryOrDoc.query ?? queryOrDoc.doc ?? "");
	if (s.includes("ListItemsAtEdge")) return ghItems(token, s, vars);
	if (s.includes("ListsEdgesPage")) return ghEdges(token, s, vars);
	if (s.includes("ViewerStarIds")) return ghStars(token, s, vars);
	if (s.includes("UpdateUserListsForItem")) return ghMut(token, s, vars);
	throw new Error("unexpected op");
};

/* ───────────── tests ───────────── */

describe("services: lists paging (GH-only helpers)", () => {
	it("streams list edges across pages", async () => {
		const token = "x";
		const seen: string[] = [];
		for await (const edges of streamListsEdges(token, ghEdgesExec)) {
			for (const e of edges) seen.push(e.node.name);
		}
		expect(seen).toEqual(["A", "B", "C"]);
	});

	it("fetches list items at edge (A via null)", async () => {
		const token = "x";
		// IMPORTANT: A is after null (no previous edge)
		const repos = await fetchListItems(token, null, "A", 25, ghItemsExec);
		expect(repos).toHaveLength(1);
		expect(repos[0]).toMatchObject({
			repoId: "R1",
			nameWithOwner: "o/r1",
			stars: 10,
			topics: ["x", "y"],
		});
	});

	it("fetches list items at edge (B via C0) → empty but valid", async () => {
		const token = "x";
		const repos = await fetchListItems(token, "C0", "B", 25, ghItemsExec);
		expect(repos).toHaveLength(0);
	});

	it("streams viewer stars", async () => {
		const token = "x";
		const out: Array<{ repoId: string; nameWithOwner: string }> = [];
		for await (const batch of streamViewerStars(token, ghStarsExec))
			out.push(...batch);
		expect(out).toEqual([
			{ repoId: "R1", nameWithOwner: "o/r1" },
			{ repoId: "R2", nameWithOwner: "o/r2" },
		]);
	});

	// it("getAllListsStream yields StarList objects end-to-end (edges+items, merged exec)", async () => {
	//   const token = "x";
	//   const lists: Array<{ name: string; repos: unknown[] }> = [];
	//   for await (const l of getAllListsStream(token, 25, mergedExec)) {
	//     lists.push(l);
	//   }
	//   expect(lists.map(x => x.name)).toEqual(["A", "B", "C"]);
	//   expect(lists.find(x => x.name === "A")!.repos).toHaveLength(1);
	//   expect(lists.find(x => x.name === "B")!.repos).toHaveLength(0);
	//   expect(lists.find(x => x.name === "C")!.repos).toHaveLength(0);
	// });

	it("updateRepoListsOnGitHub calls the mutation with payload", async () => {
		const token = "x";
		// lastUpdatePayload = null;
		await updateRepoListsOnGitHub(token, "R_global", ["L_A", "L_B"], ghMutExec);
		expect(lastUpdatePayload).toEqual({
			itemId: "R_global",
			listIds: ["L_A", "L_B"],
		});
	});

	it("getUnlistedStarsFromGh does set-diff against provided listed ids", async () => {
		const token = "x";
		const listed = new Set<string>(["R1"]); // R1 is already in lists locally
		const unlisted = await getUnlistedStarsFromGh(token, listed, ghStarsExec);
		expect(unlisted).toEqual([{ repoId: "R2", nameWithOwner: "o/r2" }]);
	});
});
