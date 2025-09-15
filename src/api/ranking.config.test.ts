import { beforeAll, describe, expect, it, mock } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { rankOne } from "./ranking.public";

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

	it("uses provided modelConfig (model, host, apiKey) instead of env", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test harness capture container
		const calls: any[] = [];
		mock.module("@lib/ollama", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: test double signature
			gen: async (prompt: string, opts: any) => {
				calls.push({ prompt, opts });
				// Return minimal JSON-ish text that scoring validator can parse; we mimic underlying service schema return.
				return JSON.stringify({
					scores: [{ list: "alpha", score: 0.9, why: "fit" }],
				});
			},
		}));

		const res = await rankOne({
			selector: "o/r",
			apply: false,
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
