import { beforeEach, describe, expect, it } from "bun:test";
import { createDb } from "@lib/db";
import { createTopicsService } from "./service";
import type { TopicMeta } from "./types";

const db = createDb();

beforeEach(() => {
	// Clean DB tables touched by the service
	db.run("DELETE FROM repo_topics");
	db.run("DELETE FROM topic_alias");
	db.run("DELETE FROM topic_related");
	db.run("DELETE FROM topics");
	db.run("DELETE FROM repo");
});

describe("topics service", () => {
	it("enrichAllRepoTopics maps repo topics, refreshes stale meta, and persists alias/related", () => {
		// Seed two repos: one active, one archived
		db.run(`INSERT INTO repo(name_with_owner, url, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled, topics)
            VALUES ('owner/one', 'u', 0, 0, 0, 0, 1, json('["Alpha","Beta"]')),
                   ('owner/two', 'u', 1, 0, 0, 0, 1, json('["Gamma"]'))`);

		// Mark all unique topics stale
		const fakeSelectStale = (universeJson: string, _ttlDays: number) => {
			const arr = JSON.parse(universeJson) as string[];
			return arr.map((t) => ({ topic: t }));
		};

		// Provide meta for alpha; leave beta null to test fallback upsert
		const fakeTopicMetaMany = (
			topics: string[],
			_opts?: { concurrency?: number },
		): Map<string, TopicMeta | null> => {
			const m = new Map<string, TopicMeta | null>();
			for (const t of topics) {
				if (t === "beta") {
					m.set(t, null);
				} else {
					m.set(t, {
						name: t,
						displayName: t.toUpperCase(),
						shortDescription: `${t} desc`,
						longDescriptionMd: `${t} body`,
						aliases: [t.slice(0, 1)],
						related: ["rss"],
						isFeatured: t === "alpha",
					});
				}
			}
			return m;
		};

		// Ensure related topic exists to satisfy FK
		db.run(
			"INSERT OR IGNORE INTO topics(topic, display_name, updated_at) VALUES ('rss', 'rss', datetime('now'))",
		);

		const svc = createTopicsService(
			{
				selectStaleTopics: fakeSelectStale,
				topicMetaMany: fakeTopicMetaMany,
			},
			db,
		);

		const res = svc.enrichAllRepoTopics({ onlyActive: true, ttlDays: 999 });
		expect(res.repos).toBe(1); // only active repo considered
		expect(res.unique_topics).toBe(2); // alpha, beta
		expect(res.refreshed).toBe(2);

		// Validate repo -> topics mapping
		const links = db
			.query<{ topic: string }, []>(
				"SELECT topic FROM repo_topics ORDER BY topic",
			)
			.all();
		expect(links.map((r) => r.topic)).toEqual(["alpha", "beta"]);

		// Validate topics table writes (alpha from meta; beta defaulted)
		const topics = db
			.query<
				{
					topic: string;
					display_name: string | null;
					short_description: string | null;
					long_description_md: string | null;
					is_featured: number;
				},
				[]
			>(
				"SELECT topic, display_name, short_description, long_description_md, is_featured FROM topics ORDER BY topic",
			)
			.all();
		expect(topics).toEqual([
			{
				topic: "alpha",
				display_name: "ALPHA",
				short_description: "alpha desc",
				long_description_md: "alpha body",
				is_featured: 1,
			},
			{
				topic: "beta",
				display_name: "beta",
				short_description: null,
				long_description_md: null,
				is_featured: 0,
			},
			{
				topic: "rss",
				display_name: "rss",
				short_description: null,
				long_description_md: null,
				is_featured: 0,
			},
		]);

		// Validate alias and related persistence for alpha
		const alias = db
			.query<{ alias: string; topic: string }, []>(
				"SELECT alias, topic FROM topic_alias ORDER BY alias",
			)
			.all();
		expect(alias).toEqual([{ alias: "a", topic: "alpha" }]);

		const related = db
			.query<{ a: string; b: string }, []>(
				"SELECT a, b FROM topic_related ORDER BY a, b",
			)
			.all();
		expect(related).toEqual([{ a: "alpha", b: "rss" }]);
	});
});
