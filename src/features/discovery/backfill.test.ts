import { describe, expect, it } from "bun:test";
import { createDb } from "@lib/db";
import { backfillCollections } from "./backfill";
import { createDiscoveryService } from "./service";

describe("curated source backfill", () => {
	it("continues after failed sources, retries them, and removes only absent source relationships", async () => {
		const db = createDb();
		try {
			const sources = [
				{ repoId: "one", nameWithOwner: "a/one", topics: ["food"] },
				{ repoId: "two", nameWithOwner: "a/two", topics: [] },
			];
			let fail = false;
			const adapter = {
				async load(source: (typeof sources)[number]) {
					if (fail && source.repoId === "two") throw new Error("offline");
					return {
						source: `github:${source.repoId}`,
						revision: "commit",
						path: "README.md",
						baseUrl: "https://example.org/",
						topics: source.topics,
						markdown: "- [Resource](https://example.org/resource)",
					};
				},
				async resolve() {
					return null;
				},
			};
			expect(
				(await backfillCollections(db, sources, adapter)).failures,
			).toHaveLength(0);
			expect(createDiscoveryService(db).work()).toHaveLength(1);
			fail = true;
			const result = await backfillCollections(db, sources, adapter);
			expect(result.failures).toHaveLength(1);
			expect(db.query("SELECT * FROM discovery_edge").all()).toHaveLength(2);
			await backfillCollections(db, [sources[1]], adapter);
			expect(
				db
					.query<{ source: string }, []>("SELECT source FROM discovery_edge")
					.all(),
			).toEqual([{ source: "github:two" }]);
			expect(db.query("SELECT * FROM recovery_provenance").all()).toHaveLength(
				2,
			);
		} finally {
			db.close();
		}
	});
});
