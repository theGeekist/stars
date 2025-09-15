import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, initSchema, setDefaultDb } from "@lib/db";
import { makeLogWithLines } from "../__test__/helpers/log";
import { ingestCore } from "./ingest";

function makeRepo(nameWithOwner: string) {
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

describe("api/ingestCore", () => {
	test("ingests from a minimal exports dir and logs details", async () => {
		const dir = mkdtempSync(join(tmpdir(), "api-ingest-"));
		const index = [
			{
				listId: "L1",
				name: "AAA",
				description: null,
				isPrivate: false,
				count: 1,
				file: "aaa.json",
			},
		];
		writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2));
		const listData = {
			listId: "L1",
			name: "AAA",
			description: null,
			isPrivate: false,
			repos: [makeRepo("o/r")],
		};
		writeFileSync(join(dir, "aaa.json"), JSON.stringify(listData, null, 2));

		// fresh DB for this test
		const db = createDb(":memory:");
		setDefaultDb(db);
		initSchema(db);

		const { log, lineCalls } = makeLogWithLines();
		const res = await ingestCore(db, log, dir);
		expect(res.lists).toBe(1);
		expect(lineCalls.some((l) => String(l).includes("Details:"))).toBe(true);
	});
});
