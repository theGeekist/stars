import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger as LibLogger } from "@lib/logger";
import type { RepoInfo, StarEdge } from "@lib/types";
import type { Ora } from "ora";
import { runListsCore, runReposCore, runStarsCore } from "./stars";

// JSON logger helper
function makeJsonLogger(): { logger: LibLogger; payloads: unknown[] } {
	const payloads: unknown[] = [];
	const logger: LibLogger = {
		info: () => {},
		success: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
		json: (v: unknown) => {
			payloads.push(v);
		},
		header: () => {},
		subheader: () => {},
		list: () => {},
		line: () => false,
		spinner: () =>
			({
				text: "",
				start() {
					return this;
				},
				stop() {
					return this;
				},
				succeed() {
					return this;
				},
				fail() {
					return this;
				},
				warn() {
					return this;
				},
				info() {
					return this;
				},
			}) as unknown as Ora,
		withSpinner: async <T>(_t: string, run: (s: Ora) => T | Promise<T>) => {
			const spinner = logger.spinner("");
			spinner.start();
			try {
				return await run(spinner);
			} finally {
				spinner.stop();
			}
		},
		columns: () => {},
	};
	return { logger, payloads };
}

// Async generator helper
async function* _gen<T>(arr: T[]) {
	for (const it of arr) yield it;
}

describe("api/stars additional coverage", () => {
	test("runReposCore prints JSON", async () => {
		const { logger, payloads } = makeJsonLogger();
		Bun.env.GITHUB_TOKEN = "x";
		const dummyRepo: RepoInfo = {
			repoId: "id",
			nameWithOwner: "o/r",
			url: "u",
			description: "",
			homepageUrl: "",
			stars: 1,
			forks: 0,
			watchers: 0,
			openIssues: 0,
			openPRs: 0,
			defaultBranch: "main",
			lastCommitISO: "",
			lastRelease: null,
			topics: [],
			primaryLanguage: "",
			languages: [],
			license: "",
			isArchived: false,
			isDisabled: false,
			isFork: false,
			isMirror: false,
			hasIssuesEnabled: true,
			pushedAt: "",
			updatedAt: "",
			createdAt: "",
			diskUsage: null,
		};
		const deps = {
			getAllLists: () => Promise.resolve([]),
			getAllListsStream: async function* () {},
			getReposFromList: (_t: string, _name: string) =>
				Promise.resolve([dummyRepo]),
			getAllStars: () => Promise.resolve([]),
			getAllStarsStream: async function* () {},
			createStarsService: () => ({
				read: {
					getAll: async () => [],
					getAllStream: async function* () {},
					collectStarIdsSet: async () => new Set<string>(),
					collectLocallyListedRepoIdsSet: async () => new Set<string>(),
					getUnlistedStars: async (_signal?: AbortSignal) => [],
					getReposToScore: async (_sel: unknown) => [],
				},
			}),
			starsLib: {
				getAllStars: async () => [],
				getAllStarsStream: async function* () {},
				collectStarIdsSet: async () => new Set<string>(),
				makeEdge: () => ({
					starredAt: "",
					node: {
						id: "id",
						nameWithOwner: "o/r",
						url: "u",
						description: "",
						homepageUrl: "",
						stargazerCount: 1,
						forkCount: 0,
						watchers: 0,
						openIssues: 0,
						openPRs: 0,
						defaultBranch: "main",
						lastCommitISO: "",
						lastRelease: null,
						topics: [],
						primaryLanguage: { name: "" },
						languages: [],
						license: "",
						isArchived: false,
						isDisabled: false,
						isFork: false,
						isMirror: false,
						hasIssuesEnabled: true,
						pushedAt: "",
						updatedAt: "",
						createdAt: "",
						diskUsage: null,
						repositoryTopics: { nodes: [] },
						// add any other required fields for the node type
					},
				}),
				getAllStarredRepoIds: async () => new Set<string>(),
				getAllStarredRepos: async () => [],
				getAllStarredReposStream: async function* () {},
				starsPage: (
					edges: StarEdge[],
					hasNextPage: boolean,
					endCursor: string | null,
				) => ({
					viewer: {
						starredRepositories: {
							pageInfo: { hasNextPage, endCursor },
							edges,
						},
					},
				}),
				VIEWER_STARS_PAGE: "",
				__testing: { mapStarEdgeToRepoInfo: () => dummyRepo },
			},
			slugify: (s: string) => s,
		};
		await runReposCore("AAA", true, logger, deps);
		expect(payloads.length).toBe(1);
	});

	test("runListsCore JSON path uses logger.json", async () => {
		const { logger, payloads } = makeJsonLogger();
		Bun.env.GITHUB_TOKEN = "x";
		const dummyRepo: RepoInfo = {
			repoId: "id",
			nameWithOwner: "o/r",
			url: "u",
			description: "",
			homepageUrl: "",
			stars: 1,
			forks: 0,
			watchers: 0,
			openIssues: 0,
			openPRs: 0,
			defaultBranch: "main",
			lastCommitISO: "",
			lastRelease: null,
			topics: [],
			primaryLanguage: "",
			languages: [] as { name: string; bytes: number }[],
			license: "",
			isArchived: false,
			isDisabled: false,
			isFork: false,
			isMirror: false,
			hasIssuesEnabled: true,
			pushedAt: "",
			updatedAt: "",
			createdAt: "",
			diskUsage: null,
		};
		const deps = {
			getAllLists: (_tok: string) =>
				Promise.resolve([
					{
						listId: "1",
						name: "A",
						description: null,
						isPrivate: false,
						repos: [dummyRepo],
					},
				]),
			getAllListsStream: async function* () {},
			getReposFromList: () => Promise.resolve([dummyRepo]),
			getAllStars: () => Promise.resolve([]),
			getAllStarsStream: async function* () {},
			createStarsService: () => ({
				read: {
					getAll: async () => [],
					getAllStream: async function* () {},
					collectStarIdsSet: async () => new Set<string>(),
					collectLocallyListedRepoIdsSet: async () => new Set<string>(),
					getUnlistedStars: async (_signal?: AbortSignal) => [],
					getReposToScore: async (_sel: unknown) => [],
				},
			}),
			starsLib: {
				getAllStars: async () => [],
				getAllStarsStream: async function* () {},
				collectStarIdsSet: async () => new Set<string>(),
				makeEdge: () => ({
					starredAt: "",
					node: {
						id: "graphql-id",
						nameWithOwner: dummyRepo.nameWithOwner,
						url: dummyRepo.url,
						description: dummyRepo.description,
						homepageUrl: dummyRepo.homepageUrl,
						stargazerCount: dummyRepo.stars,
						forkCount: dummyRepo.forks,
						watchers: dummyRepo.watchers,
						openIssues: dummyRepo.openIssues,
						openPRs: dummyRepo.openPRs,
						defaultBranch: dummyRepo.defaultBranch,
						lastCommitISO: dummyRepo.lastCommitISO,
						lastRelease: dummyRepo.lastRelease,
						topics: dummyRepo.topics,
						primaryLanguage: { name: dummyRepo.primaryLanguage || "" },
						languages: dummyRepo.languages,
						license: dummyRepo.license,
						isArchived: dummyRepo.isArchived,
						isDisabled: dummyRepo.isDisabled,
						isFork: dummyRepo.isFork,
						isMirror: dummyRepo.isMirror,
						hasIssuesEnabled: dummyRepo.hasIssuesEnabled,
						pushedAt: dummyRepo.pushedAt,
						updatedAt: dummyRepo.updatedAt,
						createdAt: dummyRepo.createdAt,
						diskUsage: dummyRepo.diskUsage,
						repositoryTopics: { nodes: [] },
					},
				}),
				getAllStarredRepoIds: async () => new Set<string>(),
				getAllStarredRepos: async () => [],
				getAllStarredReposStream: async function* () {},
				starsPage: (
					edges: StarEdge[],
					hasNextPage: boolean,
					endCursor: string | null,
				) => ({
					viewer: {
						starredRepositories: {
							pageInfo: { hasNextPage, endCursor },
							edges,
						},
					},
				}),
				VIEWER_STARS_PAGE: "",
				__testing: { mapStarEdgeToRepoInfo: () => dummyRepo },
			},
			slugify: (s: string) => s,
		};
		await runListsCore(true, undefined, undefined, logger, deps);
		expect(payloads.length).toBe(1);
	});

	test("runStarsCore writes to out file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "stars-more-"));
		const out = join(dir, "out.json");
		const { logger } = makeJsonLogger();
		Bun.env.GITHUB_TOKEN = "x";
		const dummyRepo: RepoInfo = {
			repoId: "id",
			nameWithOwner: "o/r",
			url: "u",
			description: "",
			homepageUrl: "",
			stars: 1,
			forks: 0,
			watchers: 0,
			openIssues: 0,
			openPRs: 0,
			defaultBranch: "main",
			lastCommitISO: "",
			lastRelease: null,
			topics: [],
			primaryLanguage: "",
			languages: [],
			license: "",
			isArchived: false,
			isDisabled: false,
			isFork: false,
			isMirror: false,
			hasIssuesEnabled: true,
			pushedAt: "",
			updatedAt: "",
			createdAt: "",
			diskUsage: null,
		};
		const deps = {
			getAllLists: () => Promise.resolve([]),
			getAllListsStream: async function* () {},
			getReposFromList: () => Promise.resolve([dummyRepo]),
			getAllStars: (_tok: string) => Promise.resolve([dummyRepo]),
			getAllStarsStream: async function* () {},
			createStarsService: () => ({
				read: {
					getAll: async () => [],
					getAllStream: async function* () {},
					collectStarIdsSet: async () => new Set<string>(),
					collectLocallyListedRepoIdsSet: async () => new Set<string>(),
					getUnlistedStars: async (_signal?: AbortSignal) => [],
					getReposToScore: async (_sel: unknown) => [],
				},
			}),
			starsLib: {
				getAllStars: async () => [],
				getAllStarsStream: async function* () {},
				collectStarIdsSet: async () => new Set<string>(),
				makeEdge: () => ({
					starredAt: "",
					node: {
						id: "id",
						nameWithOwner: "o/r",
						url: "u",
						description: "",
						homepageUrl: "",
						stars: 1,
						forks: 0,
						watchers: 0,
						openIssues: 0,
						openPRs: 0,
						defaultBranch: "main",
						lastCommitISO: "",
						lastRelease: null,
						topics: [],
						primaryLanguage: { name: "" },
						languages: [],
						license: "",
						isArchived: false,
						isDisabled: false,
						isFork: false,
						isMirror: false,
						hasIssuesEnabled: true,
						pushedAt: "",
						updatedAt: "",
						createdAt: "",
						diskUsage: null,
					},
				}),
				getAllStarredRepoIds: async () => new Set<string>(),
				getAllStarredRepos: async () => [],
				getAllStarredReposStream: async function* () {},
				starsPage: (
					edges: StarEdge[],
					hasNextPage: boolean,
					endCursor: string | null,
				) => ({
					viewer: {
						starredRepositories: {
							pageInfo: { hasNextPage, endCursor },
							edges,
						},
					},
				}),
				VIEWER_STARS_PAGE: "",
				__testing: { mapStarEdgeToRepoInfo: () => dummyRepo },
			},
			slugify: (s: string) => s,
		};
		await runStarsCore(false, out, undefined, logger, deps);
		const body = JSON.parse(readFileSync(out, "utf8"));
		expect(Array.isArray(body)).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});
});
