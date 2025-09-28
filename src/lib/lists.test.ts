import { describe, expect, it } from "bun:test";
import { compareAlpha } from "@lib/utils";
import { makeFakeGh } from "@src/__test__/github-fakes";
import {
	collectListMetas,
	getAllListsStream,
	getReposFromList,
	LIST_ITEMS_AT_EDGE,
	LISTS_EDGES_PAGE,
} from "./lists";
import { mapListRepoNodeToRepoInfo } from "./mapper";
import type { ListItemsAtEdge, ListsEdgesPage } from "./types";

describe("lists lib", () => {
	it("mapRepoNodeToRepoInfo maps fields safely", () => {
		const node: ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number] =
			{
				__typename: "Repository",
				repoId: "R1",
				nameWithOwner: "o/r",
				url: "https://x",
				description: "d",
				homepageUrl: null,
				stargazerCount: 10,
				forkCount: 2,
				issues: { totalCount: 3 },
				pullRequests: { totalCount: 4 },
				defaultBranchRef: {
					name: "main",
					target: { committedDate: "2024-01-01T00:00:00Z" },
				},
				primaryLanguage: { name: "TS" },
				licenseInfo: { spdxId: "MIT" },
				isArchived: false,
				isDisabled: false,
				isFork: false,
				isMirror: false,
				hasIssuesEnabled: true,
				pushedAt: "2024-01-02T00:00:00Z",
				updatedAt: "2024-01-03T00:00:00Z",
				createdAt: "2023-01-01T00:00:00Z",
				repositoryTopics: {
					nodes: [{ topic: { name: "x" } }, { topic: { name: "y" } }],
				},
			} satisfies ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number];

		const info = mapListRepoNodeToRepoInfo(node);
		expect(info).toBeDefined();
		if (!info) throw new Error("mapping failed");
		expect(info.nameWithOwner).toBe("o/r");
		expect(info.stars).toBe(10);
		expect(info.openPRs).toBe(4);
		expect(info.topics.toSorted(compareAlpha)).toEqual(
			["x", "y"].toSorted(compareAlpha),
		);
	});

	it("collectListMetas gathers edges across pages and tracks edgeBefore", async () => {
		const page1: ListsEdgesPage = {
			viewer: {
				lists: {
					pageInfo: { endCursor: "c_last1", hasNextPage: true },
					edges: [
						{
							cursor: "c1",
							node: {
								listId: "L1",
								name: "AI",
								description: "",
								isPrivate: false,
							},
						},
						{
							cursor: "c2",
							node: {
								listId: "L2",
								name: "Tools",
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
							cursor: "c3",
							node: {
								listId: "L3",
								name: "Learn",
								description: null,
								isPrivate: true,
							},
						},
					],
				},
			},
		};
		const gh = makeFakeGh({
			[LISTS_EDGES_PAGE]: (vars) => (vars?.after ? page2 : page1),
		});

		const metas = await collectListMetas("t", gh);
		expect(metas.length).toBe(3);
		expect(metas[0].edgeBefore).toBeNull();
		expect(metas[1].edgeBefore).toBe("c1");
		expect(metas[2].edgeBefore).toBe("c2");
	});

	it("getAllListsStream yields lists with repos in order", async () => {
		const listsEdges: ListsEdgesPage = {
			viewer: {
				lists: {
					pageInfo: { endCursor: null, hasNextPage: false },
					edges: [
						{
							cursor: "a",
							node: {
								listId: "L1",
								name: "AI",
								description: "",
								isPrivate: false,
							},
						},
						{
							cursor: "b",
							node: {
								listId: "L2",
								name: "Tools",
								description: null,
								isPrivate: false,
							},
						},
					],
				},
			},
		};

		const itemsResp = (name: string): ListItemsAtEdge => ({
			viewer: {
				lists: {
					nodes: [
						{
							name,
							items: {
								pageInfo: { endCursor: null, hasNextPage: false },
								nodes: [
									{
										__typename: "Repository",
										repoId: `R_${name}_1`,
										nameWithOwner: `${name.toLowerCase()}/r1`,
										url: "https://x",
										stargazerCount: 1,
										forkCount: 0,
										issues: { totalCount: 0 },
										pullRequests: { totalCount: 0 },
										repositoryTopics: { nodes: [] },
									} as unknown as ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number],
								],
							},
						},
					],
				},
			},
		});

		const gh = makeFakeGh({
			[LISTS_EDGES_PAGE]: () => listsEdges,
			[LIST_ITEMS_AT_EDGE]: (_vars) => itemsResp("ignored"),
		});

		const names: string[] = [];
		const counts: number[] = [];
		for await (const l of getAllListsStream("t", gh)) {
			names.push(l.name);
			counts.push(l.repos.length);
		}
		expect(names).toEqual(["AI", "Tools"]);
		expect(counts).toEqual([1, 1]);
	});

	it("getReposFromList finds by name and returns repos", async () => {
		const listsEdges: ListsEdgesPage = {
			viewer: {
				lists: {
					pageInfo: { endCursor: null, hasNextPage: false },
					edges: [
						{
							cursor: "a",
							node: {
								listId: "L1",
								name: "AI",
								description: "",
								isPrivate: false,
							},
						},
						{
							cursor: "b",
							node: {
								listId: "L2",
								name: "Tools",
								description: null,
								isPrivate: false,
							},
						},
					],
				},
			},
		};
		const items: ListItemsAtEdge = {
			viewer: {
				lists: {
					nodes: [
						{
							name: "AI",
							items: {
								pageInfo: { endCursor: null, hasNextPage: false },
								nodes: [
									{
										__typename: "Repository",
										repoId: "R1",
										nameWithOwner: "ai/r1",
										url: "https://x",
										stargazerCount: 2,
										forkCount: 0,
										issues: { totalCount: 0 },
										pullRequests: { totalCount: 0 },
										repositoryTopics: { nodes: [] },
									} as unknown as ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number],
								],
							},
						},
					],
				},
			},
		};

		const gh = makeFakeGh({
			[LISTS_EDGES_PAGE]: () => listsEdges,
			[LIST_ITEMS_AT_EDGE]: () => items,
		});

		const repos = await getReposFromList("t", "AI", gh);
		expect(repos.length).toBe(1);
		expect(repos[0].nameWithOwner).toBe("ai/r1");
	});
	it("getAllLists aggregates pages with concurrency", async () => {
		const listsEdges: ListsEdgesPage = {
			viewer: {
				lists: {
					pageInfo: { endCursor: null, hasNextPage: false },
					edges: [
						{
							cursor: "c1",
							node: {
								listId: "L1",
								name: "One",
								description: null,
								isPrivate: false,
							},
						},
						{
							cursor: "c2",
							node: {
								listId: "L2",
								name: "Two",
								description: null,
								isPrivate: true,
							},
						},
					],
				},
			},
		};
		const itemsResp = (name: string): ListItemsAtEdge => ({
			viewer: {
				lists: {
					nodes: [
						{
							name,
							items: {
								pageInfo: { endCursor: null, hasNextPage: false },
								nodes: [
									{
										__typename: "Repository",
										repoId: `R_${name}`,
										nameWithOwner: `${name.toLowerCase()}/r`,
										url: "u",
										repositoryTopics: { nodes: [] },
									} as unknown as ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number],
								],
							},
						},
					],
				},
			},
		});
		const gh = makeFakeGh({
			[LISTS_EDGES_PAGE]: () => listsEdges,
			[LIST_ITEMS_AT_EDGE]: (_vars) => itemsResp("ignore"),
		});
		const lists = await (await import("./lists")).getAllLists("t", gh);
		expect(lists.length).toBe(2);
		expect(lists.map((l) => l.listId)).toEqual(["L1", "L2"]);
	});

	it("getReposFromList throws when list not found", async () => {
		const listsEdges = {
			viewer: {
				lists: {
					pageInfo: { endCursor: null, hasNextPage: false },
					edges: [],
				},
			},
		} as unknown as ListsEdgesPage;
		const gh = makeFakeGh({ [LISTS_EDGES_PAGE]: () => listsEdges });
		await expect(
			(await import("./lists")).getReposFromList("t", "Missing", gh),
		).rejects.toThrow();
	});

	it("getReposFromList bubbles when list node missing during item fetch", async () => {
		const listsEdges = {
			viewer: {
				lists: {
					pageInfo: { endCursor: null, hasNextPage: false },
					edges: [
						{
							cursor: "x",
							node: {
								listId: "L",
								name: "L",
								description: null,
								isPrivate: false,
							},
						},
					],
				},
			},
		} as unknown as ListsEdgesPage;
		const itemsEmpty = {
			viewer: { lists: { nodes: [] } },
		} as unknown as ListItemsAtEdge;
		const gh = makeFakeGh({
			[LISTS_EDGES_PAGE]: () => listsEdges,
			[LIST_ITEMS_AT_EDGE]: () => itemsEmpty,
		});
		await expect(
			(await import("./lists")).getReposFromList("t", "L", gh),
		).rejects.toThrow();
	});
});
