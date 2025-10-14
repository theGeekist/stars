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

type LoggerType = typeof import("@lib/bootstrap").log;

const iso = new Date(0).toISOString();
const makeRepoInfo = (
	repoId: string,
	nameWithOwner: string,
	overrides: Partial<RepoInfo> = {},
): RepoInfo => ({
	repoId,
	nameWithOwner,
	url: `https://github.com/${nameWithOwner}`,
	description: "",
	homepageUrl: null,
	stars: 0,
	forks: 0,
	watchers: 0,
	openIssues: 0,
	openPRs: 0,
	defaultBranch: "main",
	lastCommitISO: iso,
	lastRelease: null,
	topics: [],
	primaryLanguage: null,
	languages: [],
	license: null,
	isArchived: false,
	isDisabled: false,
	isFork: false,
	isMirror: false,
	hasIssuesEnabled: true,
	pushedAt: iso,
	updatedAt: iso,
	createdAt: iso,
	diskUsage: null,
	updates: null,
	...overrides,
});

const lists: StarList[] = [
	{ listId: "1", name: "Alpha", description: "d", isPrivate: false, repos: [] },
	{ listId: "2", name: "Beta", description: null, isPrivate: false, repos: [] },
];
const reposFromList: RepoInfo[] = [
	makeRepoInfo("R1", "org/one", { stars: 100, forks: 10 }),
];
const starsPages: RepoInfo[][] = [
	[makeRepoInfo("R2", "org/two", { stars: 50, forks: 5 })],
	[makeRepoInfo("R3", "org/three", { stars: 30, forks: 3 })],
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
			makeRepoInfo("R4", "org/four", { stars: 5, forks: 1 }),
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
		const result = await fetchLists({
			onProgress: (evt) => {
				events.push(evt);
			},
		});

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
			info: () => {},
			success: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {},
			json: () => {},
			header: () => {},
			subheader: () => {},
			list: () => {},
			line: () => {},
			spinner: () => ({}) as unknown,
			withSpinner: (label: string, fn: () => Promise<RepoInfo[]>) => {
				spinnerCalls.push(label);
				return fn();
			},
			columns: () => {},
		} as unknown as LoggerType;

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
		const result = await fetchStars({
			onProgress: (evt) => {
				events.push(evt);
			},
		});

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
