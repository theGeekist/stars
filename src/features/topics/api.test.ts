import { describe, expect, it } from "bun:test";
import {
	normalizeTopics,
	selectStaleTopics,
	upsertTopic,
	reconcileRepoTopics,
} from "./api";
import { db } from "@lib/db";

describe("topics api", () => {
	it("normalizeTopics lowercases, hyphenates and dedupes", () => {
		const out = normalizeTopics(["Foo Bar", "foo-bar", "FOO   bar", "baz"]);
		expect(out.sort()).toEqual(["baz", "foo-bar"]);
	});

	it("upsertTopic stores row and selectStaleTopics respects TTL", () => {
		// Ensure clean slate for topic key
		db.run(`DELETE FROM topics WHERE topic IN ('ttl-test')`);

		// Initially stale as it's not present
		let stale = selectStaleTopics(JSON.stringify(["ttl-test"]), 30);
		expect(stale.map((r) => r.topic)).toContain("ttl-test");

		// Upsert with current timestamp
		upsertTopic({
			topic: "ttl-test",
			display_name: "TTL Test",
			short_description: "desc",
			aliases: ["tt"],
			is_featured: false,
		});

		// Should not be stale with large TTL
		stale = selectStaleTopics(JSON.stringify(["ttl-test"]), 30);
		expect(stale.find((r) => r.topic === "ttl-test")).toBeUndefined();

		// Force staleness by using negative TTL
		stale = selectStaleTopics(JSON.stringify(["ttl-test"]), -1);
		expect(stale.find((r) => r.topic === "ttl-test")).toBeDefined();
	});

	it("reconcileRepoTopics makes mapping exact for a repo", () => {
		// Insert a repo row
		db.run(`INSERT OR IGNORE INTO repo(name_with_owner, url, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
            VALUES ('user/topictest', 'https://example.com', 0, 0, 0, 0, 1)`);
		const row = db
			.query<{ id: number }, []>(
				`SELECT id FROM repo WHERE name_with_owner='user/topictest'`,
			)
			.get();
		expect(row?.id).toBeDefined();
		const repoId = row!.id;

		// Ensure topics exist to satisfy FK
		upsertTopic({ topic: "alpha" });
		upsertTopic({ topic: "beta" });
		upsertTopic({ topic: "gamma" });

		// Start with alpha+beta
		reconcileRepoTopics(repoId, ["alpha", "beta"]);
		let topics = db
			.query<{ topic: string }, [number]>(
				`SELECT topic FROM repo_topics WHERE repo_id = ? ORDER BY topic`,
			)
			.all(repoId);
		expect(topics.map((r) => r.topic)).toEqual(["alpha", "beta"]);

		// Change to beta+gamma
		reconcileRepoTopics(repoId, ["beta", "gamma"]);
		topics = db
			.query<{ topic: string }, [number]>(
				`SELECT topic FROM repo_topics WHERE repo_id = ? ORDER BY topic`,
			)
			.all(repoId);
		expect(topics.map((r) => r.topic)).toEqual(["beta", "gamma"]);
	});
});
