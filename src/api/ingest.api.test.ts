import { describe, expect, test } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import type { RepoInfo, StarList } from "@lib/types";
import { makeLogWithLines } from "../__test__/helpers/log";
import { ingestFromData } from "./ingest";

function makeRepo(nameWithOwner: string): RepoInfo {
	const now = new Date().toISOString();
	return {
		repoId: nameWithOwner.replace("/", ":"),
		nameWithOwner,
		url: `https://example.com/${nameWithOwner}`,
		description: null,
		homepageUrl: null,
		stars: 1,
		forks: 0,
		watchers: 0,
		openIssues: 0,
		openPRs: 0,
		defaultBranch: "main",
		lastCommitISO: now,
		lastRelease: null,
		topics: [],
		primaryLanguage: null,
		languages: [{ name: "ts", bytes: 1 }],
		license: null,
		isArchived: false,
		isDisabled: false,
		isFork: false,
		isMirror: false,
		hasIssuesEnabled: true,
		pushedAt: now,
		updatedAt: now,
		createdAt: now,
		diskUsage: 1,
	};
}

describe("api/ingest ingestFromData", () => {
	test("ingests lists and unlisted from memory and logs details", () => {
		const db = createDb(":memory:");
		initSchema(db);
		const { log, lineCalls } = makeLogWithLines();

		const lists: StarList[] = [
			{
				listId: "L1",
				name: "AAA",
				description: null,
				isPrivate: false,
				repos: [makeRepo("o/r1")],
			},
			{
				listId: "L2",
				name: "BBB",
				description: null,
				isPrivate: false,
				repos: [makeRepo("o/r2")],
			},
		];
		const unlisted: RepoInfo[] = [makeRepo("o/x")];

		const res = ingestFromData(lists, unlisted, db, log);
		expect(res.lists).toBe(2);
		expect(res.reposFromLists).toBe(2);
		expect(res.unlisted).toBe(1);
		expect(lineCalls.some((l) => String(l).includes("Details:"))).toBe(true);
	});

	test("ingests unlisted only", () => {
		const db = createDb(":memory:");
		initSchema(db);
		const { log } = makeLogWithLines();
		const res = ingestFromData([], [makeRepo("o/y")], db, log);
		expect(res.lists).toBe(0);
		expect(res.unlisted).toBe(1);
	});
});
