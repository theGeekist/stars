import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@lib/db";
import { createTopicsService } from "./service";

beforeEach(() => {
	// Ensure token present for service
	(Bun.env as unknown as Record<string, string>).GITHUB_TOKEN = "test-token";
	// Clean DB tables touched by the service
	db.run("DELETE FROM repo_topics");
	db.run("DELETE FROM topics");
	db.run("DELETE FROM repo");
});

describe("topics service", () => {
	it("enrichAllRepoTopics maps repo topics and refreshes stale meta", async () => {
		// Seed two repos: one active, one archived
		db.run(`INSERT INTO repo(name_with_owner, url, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled)
            VALUES ('owner/one', 'u', 0, 0, 0, 0, 1), ('owner/two', 'u', 1, 0, 0, 0, 1)`);

		// Fake repo topics
		const fakeRepoTopicsMany = async (
			_token: string,
			refs: { owner: string; name: string }[],
		) => {
			const m = new Map<string, string[]>();
			for (const r of refs)
				m.set(
					`${r.owner}/${r.name}`,
					r.name === "one" ? ["Alpha", "Beta"] : ["Gamma"],
				);
			return m;
		};

		// Mark all unique topics stale
		const fakeSelectStale = (universeJson: string, _ttlDays: number) => {
			const arr = JSON.parse(universeJson) as string[];
			return arr.map((t) => ({ topic: t }));
		};

		// Provide meta for some topics, leave one null to test fallback upsert
		const fakeTopicMetaMany = async (_token: string, topics: string[]) => {
			const m = new Map<
				string,
				{
					name: string;
					displayName?: string | null;
					shortDescription?: string | null;
					aliases?: string[];
					isFeatured?: boolean;
				} | null
			>();
			for (const t of topics) {
				if (t.toLowerCase() === "beta") {
					m.set(t, null); // no data -> default upsert
				} else {
					m.set(t, {
						name: t,
						displayName: t.toUpperCase(),
						shortDescription: `${t} desc`,
						aliases: [t.slice(0, 1)],
						isFeatured: t.toLowerCase() === "alpha",
					});
				}
			}
			return m;
		};

		const svc = createTopicsService({
			repoTopicsMany: fakeRepoTopicsMany,
			selectStaleTopics: fakeSelectStale,
			topicMetaMany: fakeTopicMetaMany,
		});

		const res = await svc.enrichAllRepoTopics({
			onlyActive: true,
			ttlDays: 999,
		});
		expect(res.repos).toBe(1); // only active repo considered
		expect(res.unique_topics).toBe(2); // Alpha, Beta
		expect(res.refreshed).toBe(2);

		// Validate DB writes
		const links = db
			.query<{ topic: string }, []>(
				"SELECT topic FROM repo_topics ORDER BY topic",
			)
			.all();
		expect(links.map((r) => r.topic)).toEqual(["alpha", "beta"]);

		const topics = db
			.query<
				{
					topic: string;
					display_name: string | null;
					short_description: string | null;
				},
				[]
			>(
				"SELECT topic, display_name, short_description FROM topics ORDER BY topic",
			)
			.all();
		// beta has no meta -> default display_name equals topic, short_description null
		expect(topics).toEqual([
			{
				topic: "alpha",
				display_name: "ALPHA",
				short_description: "alpha desc",
			},
			{ topic: "beta", display_name: "beta", short_description: null },
		]);
	});
});
