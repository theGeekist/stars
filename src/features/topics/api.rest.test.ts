import { describe, expect, it } from "bun:test";
import {
	repoTopicsManyUsing,
	repoTopicsUsing,
	topicMetaManyUsing,
} from "./api";
import type { RepoRef } from "./types";

function fakeREST(handler: (path: string) => unknown) {
	return (async (_token: string, path: string) => {
		const v = handler(path);
		if (v instanceof Error) throw v;
		return v as unknown;
	}) as unknown as typeof import("@lib/github").githubREST;
}

describe("topics REST helpers", () => {
	it("repoTopicsUsing normalizes names", async () => {
		const rest = fakeREST((path) => {
			expect(path).toContain("/repos/owner/name/topics");
			return { names: ["Alpha", "beta", "Beta "] };
		});
		const ts = await repoTopicsUsing(rest, "t", "owner", "name");
		expect(ts.sort()).toEqual(["alpha", "beta", "beta-"]);
	});

	it("repoTopicsManyUsing collects per-repo and tolerates failures", async () => {
		const calls: string[] = [];
		const rest = fakeREST((path) => {
			calls.push(path);
			if (path.includes("/repos/a/r/topics")) return { names: ["X"] };
			if (path.includes("/repos/b/r/topics")) throw new Error("boom");
			return { names: [] };
		});
		const repos: RepoRef[] = [
			{ owner: "a", name: "r" },
			{ owner: "b", name: "r" },
		];
		const map = await repoTopicsManyUsing(rest, "t", repos, { concurrency: 2 });
		expect(map.get("a/r")).toEqual(["x"]);
		expect(map.get("b/r")).toEqual([]);
		expect(calls.length).toBe(2);
	});

	it("topicMetaManyUsing maps item fields and returns null when no items", async () => {
		const rest = fakeREST((path) => {
			if (decodeURIComponent(path).includes("alpha")) {
				return {
					items: [
						{
							name: "alpha",
							display_name: "ALPHA",
							short_description: "desc",
							aliases: ["a"],
							featured: true,
						},
					],
				};
			}
			return { items: [] };
		});
		const map = await topicMetaManyUsing(rest, "t", ["Alpha", "Beta"], {
			concurrency: 2,
		});
		expect(map.get("alpha")).toEqual({
			name: "alpha",
			displayName: "ALPHA",
			shortDescription: "desc",
			aliases: ["a"],
			isFeatured: true,
		});
		expect(map.get("beta")).toBeNull();
	});
});
