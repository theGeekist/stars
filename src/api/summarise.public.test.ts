import { afterEach, describe, expect, it } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { setOllamaModuleLoaderForTests } from "@lib/ollama-loader";
import { summariseAll, summariseRepo } from "./summarise.public";

function makeDb(): ReturnType<typeof createDb> {
	const db = createDb(":memory:");
	initSchema(db);
	db.exec(`
		INSERT INTO repo(id, repo_id, name_with_owner, url, description, primary_language, topics, popularity, freshness, activeness, summary)
		VALUES
			(1, 'R_1', 'org/one', 'https://github.com/org/one', 'First repo', 'TypeScript', '[]', 0.8, 0.7, 0.9, NULL),
			(2, 'R_2', 'org/two', 'https://github.com/org/two', 'Second repo', 'TypeScript', '[]', 0.6, 0.8, 0.5, 'Existing summary');
	`);
	return db;
}

afterEach(() => {
	setOllamaModuleLoaderForTests();
});

describe("summarise public API", () => {
	it("summarises selected repos with injected model dependencies", async () => {
		const db = makeDb();
		const prompts: string[] = [];
		setOllamaModuleLoaderForTests(() => ({
			gen: async (prompt) => {
				prompts.push(prompt);
				return "A concise summary paragraph.";
			},
		}));

		const result = await summariseAll({
			dry: true,
			modelConfig: {
				model: "test-model",
				host: "http://ollama.test",
				apiKey: "test-key",
			},
			db,
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0].nameWithOwner).toBe("org/one");
		expect(result.items[0].status).toBe("ok");
		expect(prompts).toHaveLength(1);
		expect(result.stats).toEqual({
			processed: 1,
			succeeded: 1,
			failed: 0,
			saved: 0,
		});
	});

	it("resummarises existing repos and respects the limit", async () => {
		const db = makeDb();
		setOllamaModuleLoaderForTests(() => ({
			gen: async () => "Regenerated summary.",
		}));

		const result = await summariseAll({
			limit: 1,
			dry: true,
			resummarise: true,
			deps: { gen: async () => "Regenerated summary." },
			db,
		});

		expect(result.items).toHaveLength(1);
		expect(result.stats.processed).toBe(1);
	});

	it("returns an empty payload when no repos match", async () => {
		const db = createDb(":memory:");
		initSchema(db);

		const result = await summariseAll({ dry: true, db });

		expect(result.items).toEqual([]);
		expect(result.stats.processed).toBe(0);
	});

	it("saves a generated summary for one repo", async () => {
		const db = makeDb();
		const result = await summariseRepo({
			selector: "org/one",
			deps: { gen: async () => "Saved summary." },
			db,
		});

		expect(result.status).toBe("ok");
		expect(result.saved).toBe(true);
		expect(db.query("SELECT summary FROM repo WHERE id = 1").get()).toEqual({
			summary: "Saved summary.",
		});
	});

	it("returns an error for a missing repo or generation failure", async () => {
		const db = makeDb();
		const missing = await summariseRepo({ selector: "unknown/repo", db });
		expect(missing.status).toBe("error");
		expect(missing.error).toBe("repo not found");

		const failed = await summariseRepo({
			selector: "org/one",
			deps: {
				gen: async () => {
					throw new Error("LLM unavailable");
				},
			},
			dry: true,
			db,
		});
		expect(failed.status).toBe("error");
		expect(failed.error).toBe("LLM unavailable");
	});
});
