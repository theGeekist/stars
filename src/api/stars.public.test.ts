import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import type { RepoInfo, StarList } from "@lib/types";

const lists: StarList[] = [
	{ listId: "1", name: "Alpha", description: "d", isPrivate: false, repos: [] },
	{ listId: "2", name: "Beta", description: null, isPrivate: false, repos: [] },
];
const reposFromList: RepoInfo[] = [
	{
		repoId: "R1",
		nameWithOwner: "org/one",
		url: "https://github.com/org/one",
		stars: 100,
		forks: 10,
	},
];
const starsPages: RepoInfo[][] = [
	[
		{
			repoId: "R2",
			nameWithOwner: "org/two",
			url: "https://github.com/org/two",
			stars: 50,
			forks: 5,
		},
	],
	[
		{
			repoId: "R3",
			nameWithOwner: "org/three",
			url: "https://github.com/org/three",
			stars: 30,
			forks: 3,
		},
	],
];

const listStream = async function* () {
	for (const l of lists) yield l;
};
const starStream = async function* () {
	for (const page of starsPages) yield page;
};

const getReposFromList = mock(async () => reposFromList);
const collectListMetas = mock(async () =>
	lists.map((l, idx) => ({
		edgeBefore: idx === 0 ? null : `cursor-${idx}`,
		listId: l.listId,
		name: l.name,
		description: l.description ?? null,
		isPrivate: l.isPrivate,
	})),
);
const createStarsService = mock(() => ({
	read: {
		getUnlistedStars: mock(async () => [
			{
				repoId: "R4",
				nameWithOwner: "org/four",
				url: "https://github.com/org/four",
				stars: 5,
				forks: 1,
			},
		]),
	},
}));

mock.module("@lib/lists", () => ({
	getAllListsStream: () => listStream(),
	getReposFromList,
	collectListMetas,
}));
mock.module("@lib/stars", () => ({
	getAllStarsStream: () => starStream(),
}));
mock.module("@features/stars", () => ({
	createStarsService,
}));

const { fetchLists, fetchReposFromList, fetchStars, fetchUnlistedStars } =
	await import("./stars.public");

afterAll(() => {
	mock.restore();
});

beforeEach(() => {
	Bun.env.GITHUB_TOKEN = "token";
	getReposFromList.mockClear();
	createStarsService.mockClear();
	collectListMetas.mockClear();
});

afterEach(() => {
	delete Bun.env.GITHUB_TOKEN;
});

describe("fetchLists", () => {
	it("streams lists and reports progress", async () => {
		const events: unknown[] = [];
		const result = await fetchLists({ onProgress: (evt) => events.push(evt) });

		expect(result.items).toHaveLength(2);
		expect(result.items[0]).toMatchObject({ slug: "alpha" });
		expect(result.stats).toMatchObject({ count: 2 });
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			phase: "fetching:lists",
			index: 1,
			item: "Alpha",
			detail: { status: "progress", current: 1, label: "Alpha" },
			meta: { slug: "alpha" },
		});
	});
});

describe("fetchReposFromList", () => {
	it("delegates to lists lib with spinner logger", async () => {
		const spinnerCalls: string[] = [];
		const logger = {
			withSpinner: (label: string, fn: () => Promise<RepoInfo[]>) => {
				spinnerCalls.push(label);
				return fn();
			},
		} as const;

		const result = await fetchReposFromList("Alpha", { logger });

		expect(result.listName).toBe("Alpha");
		expect(result.listSlug).toBe("alpha");
		expect(result.listId).toBe("1");
		expect(result.items).toEqual(reposFromList);
		expect(result.stats).toMatchObject({ count: reposFromList.length });
		expect(spinnerCalls).toEqual(["Fetching repos for Alpha"]);
		expect(getReposFromList).toHaveBeenCalled();
		expect(collectListMetas).toHaveBeenCalled();
	});
});

describe("fetchStars", () => {
	it("collects pages and emits progress", async () => {
		const events: unknown[] = [];
		const result = await fetchStars({ onProgress: (evt) => events.push(evt) });

		expect(result.items).toHaveLength(2);
		expect(result.stats).toMatchObject({ count: 2, pages: 2 });
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			phase: "fetching:stars",
			index: 1,
			item: "page-1",
			detail: { status: "page", page: 1 },
			meta: { count: 1 },
		});
	});
});

describe("fetchUnlistedStars", () => {
	it("reads unlisted stars via service", async () => {
		const result = await fetchUnlistedStars(undefined, {});

		expect(result.items).toHaveLength(1);
		expect(result.stats).toMatchObject({ count: 1 });
		expect(createStarsService).toHaveBeenCalled();
	});
});
