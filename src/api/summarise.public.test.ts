import { afterEach, describe, expect, it } from "bun:test";
import { createDb, getDefaultDb, initSchema } from "@lib/db";
import { setOllamaModuleLoaderForTests } from "@lib/ollama-loader";
import { summariseAll, summariseRepo } from "./summarise.public";

function makeDb(): ReturnType<typeof createDb> {
	const db = createDb(":memory:");
	initSchema(db);
	db.exec(`
		INSERT INTO repo(id, repo_id, name_with_owner, url, description, primary_language, topics, popularity, freshness, activeness, summary)
		VALUES
			(1, 'R_1', 'org/one', 'https://github.com/org/one', 'Awesome list of first projects', 'TypeScript', '[]', 0.8, 0.7, 0.9, NULL),
			(2, 'R_2', 'org/two', 'https://github.com/org/two', 'Awesome list of second projects', 'TypeScript', '[]', 0.6, 0.8, 0.5, 'Existing summary');
	`);
	return db;
}

function makeAwesomeDb(name: string): ReturnType<typeof createDb> {
	const db = createDb(":memory:");
	initSchema(db);
	db.query(
		`INSERT INTO repo(id, repo_id, name_with_owner, url, description, primary_language, topics, popularity, freshness, activeness)
		 VALUES (1, ?, ?, 'https://github.com/example/awesome', 'Awesome list', 'Markdown', '["awesome"]', 0.5, 0.5, 0.5)`,
	).run(name, name);
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

	it("keeps concurrent operations on their explicit databases", async () => {
		const defaultDb = getDefaultDb();
		const firstDb = makeAwesomeDb("org/awesome-first");
		const secondDb = makeAwesomeDb("org/awesome-second");
		let releaseGeneration!: () => void;
		const generationGate = new Promise<void>((resolve) => {
			releaseGeneration = resolve;
		});
		let started = 0;
		let markBothStarted!: () => void;
		const bothStarted = new Promise<void>((resolve) => {
			markBothStarted = resolve;
		});
		const deps = {
			gen: async () => {
				started++;
				if (started === 2) markBothStarted();
				await generationGate;
				return "A concise summary.";
			},
		};

		const first = summariseRepo({
			selector: "org/awesome-first",
			dry: true,
			deps,
			db: firstDb,
		});
		const second = summariseRepo({
			selector: "org/awesome-second",
			dry: true,
			deps,
			db: secondDb,
		});
		await bothStarted;

		expect(getDefaultDb()).toBe(defaultDb);
		releaseGeneration();
		const results = await Promise.all([first, second]);
		expect(results.map((result) => result.status)).toEqual(["ok", "ok"]);
	});

	it("reports summary persistence failures instead of success", async () => {
		const db = makeDb();
		db.exec(`
			CREATE TRIGGER reject_summary_write
			BEFORE UPDATE OF summary ON repo
			BEGIN
				SELECT RAISE(ABORT, 'summary write rejected');
			END;
		`);

		const result = await summariseRepo({
			selector: "org/one",
			deps: { gen: async () => "Generated but not saved." },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.saved).toBe(false);
		expect(result.error).toBe("summary write rejected");
		expect(db.query("SELECT summary FROM repo WHERE id = 1").get()).toEqual({
			summary: null,
		});
	});

	it("returns an error for a missing repo", async () => {
		const db = makeDb();
		const missing = await summariseRepo({ selector: "unknown/repo", db });
		expect(missing.status).toBe("error");
		expect(missing.error).toBe("repo not found");
	});
});
