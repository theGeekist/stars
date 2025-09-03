import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultDb } from "@lib/db";
import { repoTopicsMany, topicMetaMany } from "./api";
import type { RepoRef } from "./types";

beforeEach(() => {
	getDefaultDb().run("DELETE FROM repo");
});

describe("topics local helpers", () => {
	it("repoTopicsMany returns normalized topics from repo table JSON", () => {
		getDefaultDb().run(`INSERT INTO repo(name_with_owner, url, is_archived, is_disabled, is_fork, is_mirror, has_issues_enabled, topics)
            VALUES ('a/r', 'u', 0, 0, 0, 0, 1, json('["X","x "]')),
                   ('b/r', 'u', 0, 0, 0, 0, 1, NULL)`);
		const refs: RepoRef[] = [
			{ owner: "a", name: "r" },
			{ owner: "b", name: "r" },
		];
		const map = repoTopicsMany(refs, { concurrency: 2 });
		expect(map.get("a/r")).toEqual(["x"]);
		expect(map.get("b/r")).toEqual([]);
	});

	it("topicMetaMany parses front-matter and body; returns null when file missing", () => {
		const base = mkdtempSync(join(tmpdir(), "explore-"));
		const alphaDir = join(base, "topics", "alpha");
		mkdirSync(alphaDir, { recursive: true });
		writeFileSync(
			join(alphaDir, "index.md"),
			`---\n` +
				`display_name: ALPHA\n` +
				`short_description: desc\n` +
				`aliases: [a, A]\n` +
				`related:\n` +
				`  - rss\n` +
				`  - readers\n` +
				`featured: true\n` +
				`created_by: GH\n` +
				`released: 2015\n` +
				`wikipedia_url: https://wikipedia.org/alpha\n` +
				`logo: alpha.png\n` +
				`---\n` +
				`Alpha body here.`,
			"utf8",
		);

		// point topicMetaMany at our temp explore clone
		(Bun.env as unknown as Record<string, string>).GH_EXPLORE_PATH = base;

		const map = topicMetaMany(["Alpha", "Beta"], { concurrency: 2 });
		expect(map.get("alpha")).toEqual({
			name: "alpha",
			displayName: "ALPHA",
			shortDescription: "desc",
			longDescriptionMd: "Alpha body here.",
			aliases: ["a", "A"],
			related: ["rss", "readers"],
			isFeatured: true,
			createdBy: "GH",
			released: "2015",
			wikipediaUrl: "https://wikipedia.org/alpha",
			logo: "alpha.png",
		});
		expect(map.get("beta")).toBeNull();
	});
});
