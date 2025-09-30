import { beforeAll, describe, expect, it, mock, afterEach } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { rankOne, rankAll } from "./ranking.public";

describe("ranking public API modelConfig DI", () => {
	const db = createDb(":memory:");
	beforeAll(() => {
		initSchema(db);
		db.exec(
			`INSERT INTO list(id, list_id, name, slug, is_private) VALUES (1,'L1','Alpha','alpha',0);`,
		);
		db.exec(`INSERT INTO repo(id, name_with_owner, url, description, topics, popularity, freshness, activeness)
             VALUES (10,'o/r','https://x','Test repo','[]',0.5,0.6,0.7);`);
	});

	afterEach(() => {
		mock.restore();
	});

	it("uses provided modelConfig (model, host, apiKey) instead of env", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test harness capture container
		const calls: any[] = [];

		// Mock the external ollama service creation
		mock.module("@jasonnathan/llm-core/ollama-service", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test mock config parameter
			createOllamaService: (config: any) => ({
				// biome-ignore lint/suspicious/noExplicitAny: test mock opts parameter
				async generatePromptAndSend(prompt: string, _opts?: any) {
					const headers = config.apiKey
						? { Authorization: `Bearer ${config.apiKey}` }
						: undefined;
					calls.push({
						prompt,
						opts: {
							model: config.model,
							host: config.host || config.endpoint,
							headers,
						},
					});
					return {
						scores: [{ list: "alpha", score: 0.9, why: "fit" }],
					};
				},
			}),
		}));

		const res = await rankOne({
			selector: "o/r",
			dry: true,
			modelConfig: {
				model: "custom-model",
				host: "http://ollama.test:11434",
				apiKey: "sek",
			},
			db,
		});
		expect(res.status).toBe("ok");
		expect(res.scores?.[0].list).toBe("alpha");
		expect(calls.length).toBeGreaterThan(0);
		const last = calls.pop();
		expect(last.opts.model).toBe("custom-model");
		expect(last.opts.host).toBe("http://ollama.test:11434");
		expect(last.opts.headers.Authorization).toBe("Bearer sek");
	});
});
