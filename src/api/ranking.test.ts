import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { rankAll, rankOne } from "./ranking.public";

describe("ranking public rankAll coverage", () => {
	const db = createDb(":memory:");
	beforeAll(() => {
		initSchema(db);
		db.exec(
			`INSERT INTO list(id, list_id, name, slug, is_private) VALUES (1,'L1','Alpha','alpha',0);`,
		);
		db.exec(`INSERT INTO repo(id, name_with_owner, url, description, topics, popularity, freshness, activeness)
             VALUES (10,'o/r1','https://x/r1','Repo one','[]',0.5,0.6,0.7);`);
		db.exec(`INSERT INTO repo(id, name_with_owner, url, description, topics, popularity, freshness, activeness)
             VALUES (11,'o/r2','https://x/r2','Repo two','[]',0.4,0.5,0.6);`);
	});

	afterEach(() => {
		mock.restore();
	});

	it("rankAll returns ok items with scores using modelConfig", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test harness capture array
		const calls: any[] = [];
		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (_config: any) => ({
				async generatePromptAndSend(prompt: string) {
					calls.push(prompt);
					return { scores: [{ list: "alpha", score: 0.42 }] };
				},
			}),
		}));
		const out = await rankAll({
			dry: true,
			modelConfig: { model: "m1" },
			db,
		});
		expect(out.items.length).toBe(2);
		expect(out.items.every((i) => i.status === "ok")).toBeTrue();
		expect(out.items[0].scores?.[0].list).toBe("alpha");
		expect(out.stats.processed).toBe(2);
		expect(calls.length).toBeGreaterThan(0);
	});

	it("rankAll marks items error when LLM output invalid", async () => {
		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (_config: any) => ({
				async generatePromptAndSend() {
					return "not-json";
				},
			}),
		}));
		const out = await rankAll({
			dry: true,
			modelConfig: { model: "m2" },
			db,
		});
		expect(out.items.length).toBe(2);
		expect(out.items.filter((i) => i.status === "error").length).toBe(2);
	});

	it("rankAll returns empty result when no repos", async () => {
		const emptyDb = createDb(":memory:");
		initSchema(emptyDb);

		const result = await rankAll({
			dry: true,
			modelConfig: { model: "test" },
			db: emptyDb,
		});

		expect(result.items).toBeArrayOfSize(0);
		expect(result.stats.processed).toBe(0);
		expect(result.stats.succeeded).toBe(0);
		expect(result.stats.failed).toBe(0);
	});

	it("rankAll respects limit parameter", async () => {
		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (_config: any) => ({
				async generatePromptAndSend() {
					return { scores: [{ list: "alpha", score: 0.5 }] };
				},
			}),
		}));

		const result = await rankAll({
			limit: 1,
			dry: true,
			modelConfig: { model: "test" },
			db,
		});

		expect(result.items).toBeArrayOfSize(1);
		expect(result.stats.processed).toBe(1);
	});

	it("rankAll calls onProgress callback", async () => {
		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (_config: any) => ({
				async generatePromptAndSend() {
					return { scores: [{ list: "alpha", score: 0.7 }] };
				},
			}),
		}));

		// biome-ignore lint/suspicious/noExplicitAny: test harness capture array
		const progressCalls: any[] = [];

		await rankAll({
			limit: 2,
			dry: true,
			modelConfig: { model: "test" },
			db,
			onProgress: (progress) => {
				progressCalls.push(progress);
			},
		});

		expect(progressCalls).toBeArrayOfSize(2);
		expect(progressCalls[0]).toMatchObject({
			phase: "ranking",
			index: 1,
			total: 2,
		});
		expect(progressCalls[1]).toMatchObject({
			phase: "ranking",
			index: 2,
			total: 2,
		});
	});
});

describe("ranking public rankOne coverage", () => {
	const db = createDb(":memory:");
	beforeAll(() => {
		initSchema(db);
		db.exec(
			`INSERT INTO list(id, list_id, name, slug, is_private) VALUES (1,'L1','TestList','test-list',0);`,
		);
		db.exec(`INSERT INTO repo(id, name_with_owner, url, description, topics, popularity, freshness, activeness, summary)
             VALUES (20,'test/single','https://github.com/test/single','Single test repo','["testing"]',0.8,0.7,0.9,'A useful testing library');`);
	});

	afterEach(() => {
		mock.restore();
	});

	it("rankOne successfully ranks existing repo", async () => {
		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (_config: any) => ({
				async generatePromptAndSend() {
					return {
						scores: [{ list: "test-list", score: 0.85, why: "good fit" }],
					};
				},
			}),
		}));

		const result = await rankOne({
			selector: "test/single",
			dry: true,
			modelConfig: { model: "test-model" },
			db,
		});

		expect(result.status).toBe("ok");
		expect(result.nameWithOwner).toBe("test/single");
		expect(result.repoId).toBe(20);
		expect(result.scores).toBeDefined();
		expect(result.scores?.[0].list).toBe("test-list");
		expect(result.scores?.[0].score).toBe(0.85);
		expect(result.saved).toBe(false); // dry run
	});

	it("rankOne handles repo not found", async () => {
		const result = await rankOne({
			selector: "nonexistent/repo",
			dry: true,
			modelConfig: { model: "test-model" },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.nameWithOwner).toBe("nonexistent/repo");
		expect(result.repoId).toBe(-1);
		expect(result.error).toBe("repo not found");
		expect(result.saved).toBe(false);
	});

	it("rankOne handles LLM errors gracefully", async () => {
		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (_config: any) => ({
				async generatePromptAndSend() {
					throw new Error("LLM service down");
				},
			}),
		}));

		const result = await rankOne({
			selector: "test/single",
			dry: true,
			modelConfig: { model: "test-model" },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.nameWithOwner).toBe("test/single");
		expect(result.repoId).toBe(20);
		expect(result.error).toBe("LLM service down");
		expect(result.saved).toBe(false);
	});

	it("rankOne uses custom LLM service when provided", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test harness capture
		const calls: any[] = [];
		const customLLM = {
			async generatePromptAndSend(prompt: string) {
				calls.push(prompt);
				return { scores: [{ list: "test-list", score: 0.95 }] };
			},
		};

		const result = await rankOne({
			selector: "test/single",
			dry: true,
			llm: customLLM,
			db,
		});

		expect(result.status).toBe("ok");
		expect(result.scores?.[0].score).toBe(0.95);
		expect(calls.length).toBeGreaterThan(0);
	});

	it("rankOne handles missing GitHub token for dry=false mode gracefully", async () => {
		// Clear any existing GITHUB_TOKEN env var for this test
		const originalToken = Bun.env.GITHUB_TOKEN;
		delete Bun.env.GITHUB_TOKEN;

		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (_config: any) => ({
				async generatePromptAndSend() {
					return { scores: [{ list: "test-list", score: 0.6 }] };
				},
			}),
		}));

		try {
			const result = await rankOne({
				selector: "test/single",
				dry: false, // This should require GITHUB_TOKEN
				modelConfig: { model: "test-model" },
				db,
			});

			expect(result.status).toBe("error");
			expect(result.error).toContain("GITHUB_TOKEN");
		} finally {
			// Restore original token
			if (originalToken) {
				Bun.env.GITHUB_TOKEN = originalToken;
			}
		}
	});
});
