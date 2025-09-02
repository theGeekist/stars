import { describe, expect, it } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { generatePromptsYaml, testOllamaReady } from "./service";

function withEnv(name: string, value: string | undefined, fn: () => void) {
	const prev = (Bun.env as Record<string, string | undefined>)[name];
	if (value === undefined)
		delete (Bun.env as Record<string, string | undefined>)[name];
	else (Bun.env as Record<string, string | undefined>)[name] = value;
	try {
		fn();
	} finally {
		if (prev === undefined)
			delete (Bun.env as Record<string, string | undefined>)[name];
		else (Bun.env as Record<string, string | undefined>)[name] = prev;
	}
}

describe("setup service", () => {
	it("testOllamaReady returns false when OLLAMA_MODEL not set", async () => {
		await withEnv("OLLAMA_MODEL", undefined, async () => {
			const res = await testOllamaReady();
			expect(res.ok).toBe(false);
			expect(String(res.reason)).toContain("OLLAMA_MODEL");
		});
	});

	it("generatePromptsYaml writes placeholders when forced", async () => {
		const out = resolve(process.cwd(), "prompts.setup.test.yaml");
		try {
			await generatePromptsYaml("t", out, { forcePlaceholder: true });
			const txt = readFileSync(out, "utf-8");
			expect(txt).toContain("criteria: |");
		} finally {
			rmSync(out, { force: true });
		}
	});

	it("generatePromptsYaml injects criteria from injected LLM and lists", async () => {
		const out = resolve(process.cwd(), "prompts.setup.test.yaml");
		try {
			const lists = [{ name: "Productivity" }, { name: "AI" }];
			const llm = async () => ({
				criteria: [
					{ slug: "productivity", description: "only score if it saves time" },
					{ slug: "ai", description: "only score if AI primary focus" },
				],
			});
			await generatePromptsYaml("t", out, {}, { lists, llm });
			const txt = readFileSync(out, "utf-8");
			expect(txt).toContain("productivity = only score if it saves time");
			expect(txt).toContain("ai = only score if AI primary focus");
		} finally {
			rmSync(out, { force: true });
		}
	});
});
