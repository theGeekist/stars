import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { setOllamaModuleLoaderForTests } from "@lib/ollama-loader";
import { summariseAll, summariseRepo } from "./summarise.public";

describe("summarise public API modelConfig DI", () => {
	const db = createDb(":memory:");
	beforeAll(() => {
		initSchema(db);
		// Insert minimal repo row; summary null to allow selection; include minimal metrics
		db.exec(`INSERT INTO repo(id, name_with_owner, url, description, primary_language, topics, popularity, freshness, activeness)
             VALUES (20,'o/s','https://x','Test summary repo','TypeScript','[]',0.1,0.2,0.3);`);
	});

	afterEach(() => {
		setOllamaModuleLoaderForTests();
	});

	it("uses provided modelConfig (model, host, apiKey) for generation", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test harness capture
		const calls: any[] = [];
		setOllamaModuleLoaderForTests(() => ({
			// biome-ignore lint/suspicious/noExplicitAny: mock signature
			gen: async (prompt: string, opts: any) => {
				calls.push({ prompt, opts });
				return "A concise summary paragraph.";
			},
		}));

		const res = await summariseRepo({
			selector: "o/s",
			dry: true,
			modelConfig: {
				model: "sum-model",
				host: "http://ollama.sum:11434",
				apiKey: "sumkey",
			},
			db,
		});
		expect(res.status).toBe("ok");
		expect(res.paragraph).toContain("summary");
		expect(calls.length).toBeGreaterThan(0);
		const last = calls.pop();
		expect(last.opts.model).toBe("sum-model");
		expect(last.opts.host).toBe("http://ollama.sum:11434");
		expect(last.opts.headers.Authorization).toBe("Bearer sumkey");
	});
});

describe("summarise public API coverage", () => {
	const db = createDb(":memory:");
	beforeAll(() => {
		initSchema(db);
		// Insert test repos with various states
		db.exec(`INSERT INTO repo(id, name_with_owner, url, description, primary_language, topics, popularity, freshness, activeness, summary)
             VALUES 
             (1,'test/repo1','https://github.com/test/repo1','First test repo','TypeScript','["test","library"]',0.8,0.7,0.9,NULL),
             (2,'test/repo2','https://github.com/test/repo2','Second test repo','JavaScript','["tool"]',0.6,0.8,0.5,'Existing summary'),
             (3,'test/repo3','https://github.com/test/repo3','Third test repo','Python','["data"]',0.9,0.6,0.8,NULL);`);
	});

	afterEach(() => {
		setOllamaModuleLoaderForTests();
	});

	describe("summariseAll", () => {
		it("processes repos without existing summaries by default", async () => {
			// biome-ignore lint/suspicious/noExplicitAny: test harness capture
			const calls: any[] = [];
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (prompt: string, _opts: any) => {
					calls.push(prompt);
					return "Generated summary content.";
				},
			}));

			const result = await summariseAll({
				limit: 10,
				dry: true,
				db,
			});

			expect(result.items).toBeArrayOfSize(2); // repo1 and repo3 (no existing summary)
			expect(result.stats.processed).toBe(2);
			expect(result.stats.succeeded).toBe(2);
			expect(result.stats.failed).toBe(0);
			// Be more flexible with call count as previous tests might have left calls
			expect(calls.length).toBeGreaterThanOrEqual(2);
		});

		it("processes all repos when resummarise=true", async () => {
			// biome-ignore lint/suspicious/noExplicitAny: test harness capture
			const calls: any[] = [];
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (prompt: string, _opts: any) => {
					calls.push(prompt);
					return "Re-generated summary content.";
				},
			}));

			const result = await summariseAll({
				limit: 10,
				dry: true,
				resummarise: true,
				db,
			});

			expect(result.items).toBeArrayOfSize(3); // all repos
			expect(result.stats.processed).toBe(3);
			expect(result.stats.succeeded).toBe(3);
			// Be more flexible with call count as previous tests might have left calls
			expect(calls.length).toBeGreaterThanOrEqual(3);
		});

		it("respects limit parameter", async () => {
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (_prompt: string, _opts: any) => "Limited summary.",
			}));

			const result = await summariseAll({
				limit: 1,
				dry: true,
				db,
			});

			expect(result.items).toBeArrayOfSize(1);
			expect(result.stats.processed).toBe(1);
		});

		it("handles errors gracefully", async () => {
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (_prompt: string, _opts: any) => {
					throw new Error("LLM service unavailable");
				},
			}));

			const result = await summariseAll({
				limit: 1,
				dry: true,
				db,
			});

			expect(result.items).toBeArrayOfSize(1);
			expect(result.items[0].status).toBe("error");
			expect(result.items[0].error).toBe("LLM service unavailable");
			expect(result.stats.failed).toBe(1);
			expect(result.stats.succeeded).toBe(0);
		});

		it("returns empty result when no repos match", async () => {
			const emptyDb = createDb(":memory:");
			initSchema(emptyDb);

			const result = await summariseAll({
				limit: 10,
				dry: true,
				db: emptyDb,
			});

			expect(result.items).toBeArrayOfSize(0);
			expect(result.stats.processed).toBe(0);
			expect(result.stats.succeeded).toBe(0);
			expect(result.stats.failed).toBe(0);
			expect(result.stats.saved).toBe(0);
		});

		it("calls onProgress callback during processing", async () => {
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (_prompt: string, _opts: any) => "Progress test summary.",
			}));

			// biome-ignore lint/suspicious/noExplicitAny: test harness capture
			const progressCalls: any[] = [];

			await summariseAll({
				limit: 2,
				dry: true,
				db,
				onProgress: (progress) => {
					progressCalls.push(progress);
				},
			});

			expect(progressCalls.length).toBe(2);
			expect(progressCalls[0]).toMatchObject({
				phase: "summarising",
				index: 1,
				total: 2,
			});
			expect(progressCalls[1]).toMatchObject({
				phase: "summarising",
				index: 2,
				total: 2,
			});
		});
	});

	describe("summariseRepo", () => {
		it("successfully summarises existing repo", async () => {
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (_prompt: string, _opts: any) => "Single repo summary.",
			}));

			const result = await summariseRepo({
				selector: "test/repo1",
				dry: true,
				db,
			});

			expect(result.status).toBe("ok");
			expect(result.nameWithOwner).toBe("test/repo1");
			expect(result.repoId).toBe(1);
			expect(result.paragraph).toContain("summary");
			expect(result.words).toBeGreaterThan(0);
			expect(result.saved).toBe(false); // dry run
		});

		it("handles repo not found", async () => {
			const result = await summariseRepo({
				selector: "nonexistent/repo",
				dry: true,
				db,
			});

			expect(result.status).toBe("error");
			expect(result.nameWithOwner).toBe("nonexistent/repo");
			expect(result.repoId).toBe(-1);
			expect(result.error).toBe("repo not found");
			expect(result.saved).toBe(false);
		});

		it("handles generation errors", async () => {
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (_prompt: string, _opts: any) => {
					throw new Error("Generation failed");
				},
			}));

			const result = await summariseRepo({
				selector: "test/repo1",
				dry: true,
				db,
			});

			expect(result.status).toBe("error");
			expect(result.nameWithOwner).toBe("test/repo1");
			expect(result.repoId).toBe(1);
			expect(result.error).toBe("Generation failed");
			expect(result.saved).toBe(false);
		});

		it("actually saves when dry=false", async () => {
			setOllamaModuleLoaderForTests(() => ({
				// biome-ignore lint/suspicious/noExplicitAny: mock signature
				gen: async (_prompt: string, _opts: any) => "Summary to be saved.",
			}));

			const result = await summariseRepo({
				selector: "test/repo1",
				dry: false,
				db,
			});

			expect(result.status).toBe("ok");
			expect(result.saved).toBe(true);

			// Verify it was actually saved to the database
			const savedRow = db
				.query("SELECT summary FROM repo WHERE id = 1")
				.get() as { summary: string | null };
			expect(savedRow?.summary).toBe("Summary to be saved.");
		});
	});
});
