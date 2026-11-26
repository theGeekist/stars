import { describe, expect, it } from "bun:test";
import { mapListRepoNodeToRepoInfo, mapStarEdgeToRepoInfo } from "./mapper";

describe("mapper coverage", () => {
	it("returns null for non-repository nodes and missing repo ids", () => {
		const notRepo = { __typename: "Team" } as unknown as Parameters<
			typeof mapListRepoNodeToRepoInfo
		>[0];
		const missingRepoId = {
			__typename: "Repository",
			repoId: null,
		} as unknown as Parameters<typeof mapListRepoNodeToRepoInfo>[0];
		expect(mapListRepoNodeToRepoInfo(notRepo)).toBeNull();
		expect(mapListRepoNodeToRepoInfo(missingRepoId)).toBeNull();
	});

	it("maps repository nodes with updates metadata", () => {
		const node = {
			__typename: "Repository",
			repoId: "R_123",
			id: "RID",
			nameWithOwner: "owner/repo",
			url: "https://example.com/repo",
			description: "Great project",
			homepageUrl: "https://example.com",
			stargazerCount: 42,
			forkCount: 7,
			watchers: { totalCount: 5 },
			issues: { totalCount: 3 },
			pullRequests: { totalCount: 2 },
			defaultBranchRef: {
				name: "main",
				target: {
					committedDate: "2024-03-01T00:00:00Z",
					history: {
						nodes: [
							{
								committedDate: "2024-02-20T00:00:00Z",
								messageHeadline: "feat: add support",
							},
							{
								committedDate: "2024-02-18T00:00:00Z",
								messageHeadline: "docs: update readme",
							},
						],
					},
				},
			},
			repositoryTopics: {
				nodes: [{ topic: { name: "bun" } }, { topic: { name: null } }],
			},
			primaryLanguage: { name: "TypeScript" },
			languages: {
				edges: [
					{ node: { name: "TypeScript" }, size: 1200 },
					{ node: { name: "" }, size: null },
				],
			},
			licenseInfo: { spdxId: "MIT" },
			isArchived: false,
			isDisabled: false,
			isFork: true,
			isMirror: false,
			hasIssuesEnabled: false,
			pushedAt: "2024-02-01T00:00:00Z",
			updatedAt: "2024-02-15T00:00:00Z",
			createdAt: "2020-01-01T00:00:00Z",
			diskUsage: 2048,
			releases: {
				nodes: [
					{
						tagName: "v1.0.0",
						publishedAt: "2024-02-10T00:00:00Z",
						url: "https://example.com/releases/v1.0.0",
					},
				],
			},
			changelogRoot: { __typename: "Blob", byteSize: 1024, oid: "oid-1" },
			changelogNews: { __typename: "Blob", oid: "oid-2" },
			hasDiscussionsEnabled: true,
			discussionCategories: {
				nodes: [
					{ id: "c1", name: "Announcements", slug: "announce" },
					{ id: "c2", name: "General", slug: "general" },
				],
			},
		} as const;

		const info = mapListRepoNodeToRepoInfo(
			node as unknown as Parameters<typeof mapListRepoNodeToRepoInfo>[0],
		);
		expect(info).not.toBeNull();
		expect(info?.repoId).toBe("R_123");
		expect(info?.languages).toEqual([{ name: "TypeScript", bytes: 1200 }]);
		expect(info?.topics).toEqual(["bun"]);
		expect(info?.hasIssuesEnabled).toBe(false);
		expect(info?.lastRelease).toEqual({
			tagName: "v1.0.0",
			publishedAt: "2024-02-10T00:00:00Z",
			url: "https://example.com/releases/v1.0.0",
		});
		expect(info?.updates?.preferred).toBe("release");
		const updateTypes = info?.updates?.candidates?.map((c) => c.type).sort();
		expect(updateTypes).toEqual([
			"changelog",
			"commit",
			"discussion",
			"release",
		]);
		const commitCandidate = info?.updates?.candidates?.find(
			(c) => c.type === "commit",
		);
		expect(commitCandidate?.confidence).toBe(0.45);
	});

	it("uses id field for star edges and defaults missing booleans", () => {
		const edge = {
			node: {
				id: "RepoNode",
				nameWithOwner: "owner/starred",
				url: "https://example.com/starred",
				description: null,
				homepageUrl: null,
				stargazerCount: 5,
				forkCount: 1,
				watchers: { totalCount: 0 },
				issues: { totalCount: 0 },
				pullRequests: { totalCount: 0 },
				defaultBranchRef: { target: { history: { nodes: [] } } },
				repositoryTopics: { nodes: [] },
				primaryLanguage: null,
				languages: { edges: [] },
				licenseInfo: null,
				hasIssuesEnabled: undefined,
				pushedAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-02T00:00:00Z",
				createdAt: "2023-12-01T00:00:00Z",
				diskUsage: null,
				releases: { nodes: [] },
				hasDiscussionsEnabled: false,
			},
		} as const;

		const info = mapStarEdgeToRepoInfo(
			edge as unknown as Parameters<typeof mapStarEdgeToRepoInfo>[0],
		);
		expect(info.repoId).toBe("RepoNode");
		expect(info.hasIssuesEnabled).toBe(true);
		expect(info.updates).toBeUndefined();
	});
});
