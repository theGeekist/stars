import { afterAll, describe, expect, it, mock } from "bun:test";
import type { RepoInfo } from "@lib/types";

const ingestCore = mock(async () => ({
	lists: 1,
	reposFromLists: 2,
	unlisted: 3,
}));
const ingestListedFromGh = mock(async () => ({
	lists: 1,
	reposFromLists: 2,
	unlisted: 0,
}));
const ingestUnlistedFromGh = mock(async () => ({
	lists: 0,
	reposFromLists: 0,
	unlisted: 5,
}));
const ingestFromData = mock(() => ({
	lists: 2,
	reposFromLists: 4,
	unlisted: 1,
}));

mock.module("./ingest", () => ({
	ingestCore,
	ingestListedFromGh,
	ingestUnlistedFromGh,
	ingestFromData,
}));

const { ingestAll, ingestListsOnly, ingestUnlistedOnly, ingestFromMemory } =
	await import("./ingest.public");

afterAll(() => {
	mock.restore();
});

describe("ingestAll", () => {
	it("wraps core ingest with progress events", async () => {
		const events: Array<{ phase: string; detail?: unknown }> = [];
		const result = await ingestAll({
			onProgress: (evt) =>
				events.push({ phase: evt.phase, detail: evt.detail }),
		});

		expect(result).toEqual({ lists: 1, reposFromLists: 2, unlisted: 3 });
		expect(events).toEqual([
			{ phase: "ingesting:lists+unlisted", detail: { status: "start" } },
			{ phase: "ingesting:lists+unlisted", detail: { status: "done" } },
		]);
	});
});

describe("ingestListsOnly", () => {
	it("invokes listed ingest and emits phases", async () => {
		const events: Array<{ phase: string; detail?: unknown }> = [];
		const result = await ingestListsOnly({
			onProgress: (evt) =>
				events.push({ phase: evt.phase, detail: evt.detail }),
		});

		expect(result).toEqual({ lists: 1, reposFromLists: 2, unlisted: 0 });
		expect(events).toEqual([
			{ phase: "ingesting:lists", detail: { status: "start" } },
			{ phase: "ingesting:lists", detail: { status: "done" } },
		]);
	});
});

describe("ingestUnlistedOnly", () => {
	it("invokes unlisted ingest and emits phases", async () => {
		const events: Array<{ phase: string; detail?: unknown }> = [];
		const result = await ingestUnlistedOnly({
			onProgress: (evt) =>
				events.push({ phase: evt.phase, detail: evt.detail }),
		});

		expect(result).toEqual({ lists: 0, reposFromLists: 0, unlisted: 5 });
		expect(events).toEqual([
			{ phase: "ingesting:unlisted", detail: { status: "start" } },
			{ phase: "ingesting:unlisted", detail: { status: "done" } },
		]);
	});
});

describe("ingestFromMemory", () => {
	it("delegates to ingestFromData and emits phases", () => {
		const events: Array<{ phase: string; detail?: unknown }> = [];
		const result = ingestFromMemory([], [] as RepoInfo[], {
			onProgress: (evt) =>
				events.push({ phase: evt.phase, detail: evt.detail }),
		});

		expect(result).toEqual({ lists: 2, reposFromLists: 4, unlisted: 1 });
		expect(events).toEqual([
			{ phase: "ingesting:memory", detail: { status: "start" } },
			{ phase: "ingesting:memory", detail: { status: "done" } },
		]);
	});
});
