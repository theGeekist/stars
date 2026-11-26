import { describe, expect, it } from "bun:test";
import { githubDiscovery } from "./github";

describe("GitHub discovery adapter", () => {
	it("loads a pinned README and resolves a GitHub repository identity", async () => {
		const original = globalThis.fetch;
		const calls: string[] = [];
		globalThis.fetch = (async (
			request: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = String(request);
			calls.push(url);
			if (url.endsWith("/commits/HEAD"))
				return Response.json({ sha: "abc123" });
			if (url.includes("/readme?ref=abc123"))
				return Response.json({
					path: "README.md",
					encoding: "base64",
					content: Buffer.from("# Cookbooks").toString("base64"),
				});
			if (url.endsWith("/graphql")) {
				const body = JSON.parse(String(init?.body));
				if (body.query.includes("DiscoverySource"))
					return Response.json({ data: { repository: { id: "source-node" } } });
				return Response.json({
					data: {
						repository: {
							id: "stable-node",
							nameWithOwner: "a/renamed",
							url: "https://github.com/a/renamed",
						},
					},
				});
			}
			throw new Error(`Unexpected network call: ${url}`);
		}) as typeof fetch;
		try {
			const adapter = githubDiscovery("test-token");
			const source = await adapter.load({
				repoId: "source-node",
				nameWithOwner: "a/list",
				topics: ["food"],
			});
			expect(source).toMatchObject({
				source: "github:source-node",
				revision: "abc123",
				path: "README.md",
				markdown: "# Cookbooks",
			});
			const repo = await adapter.resolve(
				"https://github.com/a/old/tree/main/cook",
			);
			expect(repo).toMatchObject({
				repoId: "stable-node",
				nameWithOwner: "a/renamed",
			});
			expect(
				await adapter.resolve("https://github.com/A/OLD/blob/main/file.md"),
			).toMatchObject({ repoId: "stable-node" });
			expect(await adapter.resolve("https://github.com/a/old")).toMatchObject({
				repoId: "stable-node",
			});
			expect(await adapter.resolve("https://example.org/food")).toBeNull();
			expect(calls).toHaveLength(4);
			await expect(
				adapter.load({
					repoId: "other-node",
					nameWithOwner: "a/list",
					topics: [],
				}),
			).rejects.toThrow("Collection identity changed");
		} finally {
			globalThis.fetch = original;
		}
	});
	it("does not cache a failed repository resolution", async () => {
		const original = globalThis.fetch;
		let count = 0;
		globalThis.fetch = (async () =>
			Response.json({
				data: {
					repository:
						++count === 1
							? null
							: {
									id: "node",
									nameWithOwner: "a/b",
									url: "https://github.com/a/b",
								},
				},
			})) as unknown as typeof fetch;
		try {
			const adapter = githubDiscovery("test-token");
			await expect(adapter.resolve("https://github.com/a/b")).rejects.toThrow(
				"Repository not found",
			);
			expect(await adapter.resolve("https://github.com/a/b")).toMatchObject({
				repoId: "node",
			});
			expect(count).toBe(2);
		} finally {
			globalThis.fetch = original;
		}
	});
});
