// src/lib/stars.test.ts
import { describe, expect, it } from "bun:test";
import { makeFakeGh } from "@src/__test__/github-fakes";
import {
	__testing,
	collectStarIdsSet,
	getAllStars,
	getAllStarsStream,
	makeEdge,
	starsPage,
	VIEWER_STARS_PAGE,
} from "./stars";
import type { RepoInfo, StarEdge } from "./types";
import { compareAlpha } from "./utils";

/* ---------------------------------- tests ---------------------------------- */

describe("stars lib", () => {
	it("mapStarEdgeToRepoInfo maps fields safely", () => {
		const edge = makeEdge({
			node: {
				id: "R1",
				nameWithOwner: "o/r",
				url: "https://x",
				stargazerCount: 42,
				forkCount: 7,
				issues: { totalCount: 5 },
				pullRequests: { totalCount: 2 },
				primaryLanguage: { name: "TypeScript" },
				licenseInfo: { spdxId: "MIT" },
				repositoryTopics: {
					nodes: [{ topic: { name: "alpha" } }, { topic: { name: "beta" } }],
				},
			},
		});

		const info: RepoInfo = __testing.mapStarEdgeToRepoInfo(edge);
		expect(info.repoId).toBe("R1");
		expect(info.nameWithOwner).toBe("o/r");
		expect(info.url).toBe("https://x");
		expect(info.stars).toBe(42);
		expect(info.forks).toBe(7);
		expect(info.openIssues).toBe(5);
		expect(info.openPRs).toBe(2);
		expect(info.primaryLanguage).toBe("TypeScript");
		expect(info.license).toBe("MIT");
		expect(new Set(info.topics)).toEqual(new Set(["alpha", "beta"]));
		expect(info.defaultBranch).toBe("main");
		expect(info.lastCommitISO).toBe("2024-01-02T00:00:00Z");
	});

	it("getAllStarsStream yields RepoInfo[] batches in order", async () => {
		const p1 = starsPage(
			[makeEdge({ node: { id: "R_A", nameWithOwner: "a/r", url: "" } })],
			true,
			"cursor1",
		);
		const p2 = starsPage(
			[makeEdge({ node: { id: "R_B", nameWithOwner: "b/r", url: "" } })],
			false,
			null,
		);

		const gh = makeFakeGh({
			[VIEWER_STARS_PAGE]: (vars) => (vars?.after ? p2 : p1),
		});

		const seen: string[] = [];
		for await (const batch of getAllStarsStream("t", gh)) {
			for (const r of batch) seen.push(r.nameWithOwner);
		}
		expect(seen).toEqual(["a/r", "b/r"]);
	});

	it("getAllStars aggregates across pages", async () => {
		const p1 = starsPage(
			[makeEdge({ node: { id: "R1", nameWithOwner: "o1/r1", url: "" } })],
			true,
			"c1",
		);
		const p2 = starsPage(
			[makeEdge({ node: { id: "R2", nameWithOwner: "o2/r2", url: "" } })],
			true,
			"c2",
		);
		const p3 = starsPage(
			[makeEdge({ node: { id: "R3", nameWithOwner: "o3/r3", url: "" } })],
			false,
			null,
		);

		const gh = makeFakeGh({
			[VIEWER_STARS_PAGE]: (vars) =>
				!vars?.after ? p1 : vars.after === "c1" ? p2 : p3,
		});

		const all = await getAllStars("t", gh);
		expect(all.map((r) => r.nameWithOwner)).toEqual([
			"o1/r1",
			"o2/r2",
			"o3/r3",
		]);
	});

	it("collectStarIdsSet returns the set of repo IDs", async () => {
		const p1 = starsPage(
			[
				makeEdge({ node: { id: "R1", nameWithOwner: "o1/r1", url: "" } }),
				makeEdge({ node: { id: "R2", nameWithOwner: "o2/r2", url: "" } }),
			],
			true,
			"c1",
		);
		const p2 = starsPage(
			[makeEdge({ node: { id: "R3", nameWithOwner: "o3/r3", url: "" } })],
			false,
			null,
		);

		const gh = makeFakeGh({
			[VIEWER_STARS_PAGE]: (vars) => (vars?.after ? p2 : p1),
		});

		const ids = await collectStarIdsSet("t", gh);
		expect([...ids].toSorted(compareAlpha)).toEqual(["R1", "R2", "R3"]);
	});

	it("handles optional/null-ish fields without crashing (defensive mapping)", async () => {
		const edge: StarEdge = {
			starredAt: "2024-01-01T00:00:00Z",
			node: {
				id: "RZ",
				nameWithOwner: "o/rz",
				url: "u",
				description: null,
				homepageUrl: null,
				stargazerCount: 0,
				forkCount: 0,
				issues: { totalCount: 0 },
				pullRequests: { totalCount: 0 },
				defaultBranchRef: { name: null, target: {} },
				primaryLanguage: null,
				licenseInfo: null,
				isArchived: false,
				isDisabled: false,
				isFork: false,
				isMirror: false,
				hasIssuesEnabled: false,
				pushedAt: "",
				updatedAt: "",
				createdAt: "",
				repositoryTopics: { nodes: [null, { topic: { name: null } }] },
			},
		};

		const gh = makeFakeGh({
			[VIEWER_STARS_PAGE]: () => starsPage([edge], false, null),
		});

		const all = await getAllStars("t", gh);
		expect(all.length).toBe(1);
		const r = all[0];
		expect(r.repoId).toBe("RZ");
		expect(r.defaultBranch).toBeNull();
		expect(r.lastCommitISO).toBeUndefined();
		expect(r.primaryLanguage).toBeNull();
		expect(r.license).toBeNull();
		expect(r.topics).toEqual([]);
	});
});
