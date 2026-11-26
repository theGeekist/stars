import { describe, expect, it, mock } from "bun:test";
import type { RepoInfo, StarList } from "@lib/types";
import {
	fetchLists,
	fetchReposFromList,
	fetchStars,
	fetchUnlistedStars,
	type StarsFetchDependencies,
} from "./stars.public";

const iso = new Date(0).toISOString();
const makeRepoInfo = (repoId: string, nameWithOwner: string): RepoInfo => ({
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
});

const lists: StarList[] = [
	{ listId: "1", name: "Alpha", description: "d", isPrivate: false, repos: [] },
	{ listId: "2", name: "Beta", description: null, isPrivate: false, repos: [] },
];
const reposFromList = [makeRepoInfo("R1", "org/one")];
const starsPages = [
	[makeRepoInfo("R2", "org/two")],
	[makeRepoInfo("R3", "org/three")],
];

const deps: StarsFetchDependencies = {
	lists: {
		getAllListsStream: async function* () {
			yield* lists;
		},
		getReposFromList: mock(async () => reposFromList),
		collectListMetas: mock(async () =>
			lists.map((list) => ({
				listId: list.listId,
				name: list.name,
				description: list.description ?? null,
				isPrivate: list.isPrivate,
				edgeBefore: null,
			})),
		),
	},
	stars: {
		getAllStarsStream: async function* () {
			yield* starsPages;
		},
	},
	createStarsService: (() => ({
		read: {
			getUnlistedStars: mock(async () => [makeRepoInfo("R4", "org/four")]),
		},
	})) as unknown as StarsFetchDependencies["createStarsService"],
};

describe("public stars and lists API", () => {
	it("streams lists and reports progress", async () => {
		const events: unknown[] = [];
		const result = await fetchLists({
			GITHUB_TOKEN: "token",
			deps,
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(result.items).toHaveLength(2);
		expect(result.items[0]).toMatchObject({ slug: "alpha" });
		expect(result.stats.count).toBe(2);
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			phase: "fetching:lists",
			index: 1,
			item: "Alpha",
			meta: { slug: "alpha" },
		});
	});

	it("fetches list repos and resolves the list id", async () => {
		const result = await fetchReposFromList("Alpha", {
			GITHUB_TOKEN: "token",
			deps,
		});

		expect(result).toMatchObject({
			listName: "Alpha",
			listSlug: "alpha",
			listId: "1",
			items: reposFromList,
			stats: { count: 1 },
		});
	});

	it("collects star pages and emits progress", async () => {
		const events: unknown[] = [];
		const result = await fetchStars({
			GITHUB_TOKEN: "token",
			deps,
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(result.items).toHaveLength(2);
		expect(result.stats).toMatchObject({ count: 2, pages: 2 });
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			phase: "fetching:stars",
			index: 1,
			meta: { count: 1 },
		});
	});

	it("returns unlisted stars from the injected service", async () => {
		const db = {} as Parameters<typeof fetchUnlistedStars>[0];
		const result = await fetchUnlistedStars(db, { deps });

		expect(result.items).toHaveLength(1);
		expect(result.items[0].nameWithOwner).toBe("org/four");
		expect(result.stats.count).toBe(1);
	});
});
