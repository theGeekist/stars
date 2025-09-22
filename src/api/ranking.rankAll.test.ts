import { beforeAll, describe, expect, it, mock } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { rankAll } from "./ranking.public";

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
});
