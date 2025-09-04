import { describe, expect, it } from "bun:test";
import { makeFakeGh } from "@src/__test__/github-fakes";
import {
	getAllLists,
	getAllListsStream,
	LIST_ITEMS_AT_EDGE,
	LISTS_EDGES_PAGE,
} from "./lists";
import type { ListItemsAtEdge, ListsEdgesPage } from "./types";

describe("lists coverage (DEBUG paths)", () => {
	it("getAllLists logs with DEBUG and uses pMap workers", async () => {
		const prev = Bun.env.DEBUG;
		(Bun.env as unknown as Record<string, string>).DEBUG = "1";

		const page1: ListsEdgesPage = {
			viewer: {
				lists: {
					pageInfo: { endCursor: "CUR1", hasNextPage: true },
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
								isPrivate: false,
							},
						},
					],
				},
			},
		};
		const page2: ListsEdgesPage = {
			viewer: {
				lists: { pageInfo: { endCursor: null, hasNextPage: false }, edges: [] },
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
									},
								],
							},
						},
					],
				},
			},
		});

		const gh = makeFakeGh([
			{
				[LISTS_EDGES_PAGE]: () => page1,
				[LIST_ITEMS_AT_EDGE]: (_v) => itemsResp("one"),
			},
			{
				[LISTS_EDGES_PAGE]: () => page2,
				[LIST_ITEMS_AT_EDGE]: (_v) => itemsResp("two"),
			},
		]);

		const lists = await getAllLists("t", gh);
		expect(lists.length).toBe(2);
		expect(lists.map((l) => l.listId)).toEqual(["L1", "L2"]);
		if (prev == null)
			delete (Bun.env as unknown as Record<string, string>).DEBUG;
		else (Bun.env as unknown as Record<string, string>).DEBUG = prev as string;
	});

	it("getAllListsStream handles multi-page list edges with DEBUG", async () => {
		const prev = Bun.env.DEBUG;
		(Bun.env as unknown as Record<string, string>).DEBUG = "1";

		const page1: ListsEdgesPage = {
			viewer: {
				lists: {
					pageInfo: { endCursor: "EC1", hasNextPage: true },
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
							cursor: "c2",
							node: {
								listId: "L2",
								name: "Two",
								description: null,
								isPrivate: false,
							},
						},
					],
				},
			},
		};
		const itemsResp: ListItemsAtEdge = {
			viewer: {
				lists: {
					nodes: [
						{
							name: "One",
							items: {
								pageInfo: { endCursor: null, hasNextPage: false },
								nodes: [
									{
										__typename: "Repository",
										repoId: "R",
										nameWithOwner: "x/r",
										url: "u",
										repositoryTopics: { nodes: [] },
									} as unknown as ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number],
								],
							},
						},
					],
				},
			},
		} as unknown as ListItemsAtEdge;

		const gh = makeFakeGh([
			{
				[LISTS_EDGES_PAGE]: () => page1,
				[LIST_ITEMS_AT_EDGE]: () => itemsResp,
			},
			{
				[LISTS_EDGES_PAGE]: () => page2,
				[LIST_ITEMS_AT_EDGE]: () => itemsResp,
			},
		]);

		const ids: string[] = [];
		for await (const l of getAllListsStream("t", gh)) ids.push(l.listId);
		expect(ids).toEqual(["L1", "L2"]);
		if (prev == null)
			delete (Bun.env as unknown as Record<string, string>).DEBUG;
		else (Bun.env as unknown as Record<string, string>).DEBUG = prev as string;
	});
});
