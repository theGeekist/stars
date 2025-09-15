import { beforeAll, describe, expect, it, mock } from "bun:test";
import { createDb, initSchema } from "@lib/db";
import { summariseRepo } from "./summarise.public";

describe("summarise public API modelConfig DI", () => {
	const db = createDb(":memory:");
	beforeAll(() => {
		initSchema(db);
		// Insert minimal repo row; summary null to allow selection; include minimal metrics
		db.exec(`INSERT INTO repo(id, name_with_owner, url, description, primary_language, topics, popularity, freshness, activeness)
             VALUES (20,'o/s','https://x','Test summary repo','TypeScript','[]',0.1,0.2,0.3);`);
	});

	it("uses provided modelConfig (model, host, apiKey) for generation", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test harness capture
		const calls: any[] = [];
		mock.module("@lib/ollama", () => ({
			// biome-ignore lint/suspicious/noExplicitAny: mock signature
			gen: async (prompt: string, opts: any) => {
				calls.push({ prompt, opts });
				return "A concise summary paragraph.";
			},
		}));

		const res = await summariseRepo({
			selector: "o/s",
			apply: false,
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
