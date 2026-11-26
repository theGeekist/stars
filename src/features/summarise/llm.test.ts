import { afterEach, describe, expect, it, mock } from "bun:test";
import { writeFileSync } from "node:fs";
import { summariseRepoOneParagraph } from "@features/summarise/llm";
import { setOllamaModuleLoaderForTests } from "@lib/ollama-loader";
import { inTempDir } from "@src/__test__/helpers/fs";
import type { Meta } from "./types";

afterEach(() => {
	mock.restore();
	setOllamaModuleLoaderForTests();
});

describe("summariseRepoOneParagraph", () => {
	it("short-circuits awesome lists based on metadata", async () => {
		const meta: Meta = {
			nameWithOwner: "sindresorhus/awesome",
			url: "https://github.com/sindresorhus/awesome",
			description: "An awesome list",
			topics: ["awesome"],
		};
		const out = await summariseRepoOneParagraph(meta);
		expect(typeof out).toBe("string");
		expect(out.length).toBeGreaterThan(0);
	});

	it("uses metadata-only path when README missing (mocked)", async () => {
		// Mock readme fetch to return null so it takes the metadata-only prompt path
		mock.module("@lib/readme", () => ({
			fetchReadmeWithCache: async () => null,
			cleanMarkdown: (s: string) => s,
			chunkMarkdown: (_: string) => [],
		}));
		// Mock gen to return a deterministic paragraph
		setOllamaModuleLoaderForTests(() => ({
			gen: async (_: string) => "This project is a tool that helps developers.",
		}));

		const meta: Meta = {
			nameWithOwner: "owner/repo",
			url: "https://example.com",
			description: "CLI utility",
			primaryLanguage: "TypeScript",
			topics: ["cli"],
		};
		const out = await summariseRepoOneParagraph(meta);
		expect(out).toContain("project");
	});

	it("uses embedding path with chunk selection (mocked)", async () => {
		// Mock readme with long content and chunker returning many chunks
		mock.module("@lib/readme", () => ({
			fetchReadmeWithCache: async () => "X".repeat(26000),
			cleanMarkdown: (s: string) => `${s}\nIntro\n`,
			chunkMarkdown: (_: string) => [
				"chunk one about purpose",
				"chunk two about arch",
				"chunk three about features",
				"chunk four",
				"chunk five",
				"chunk six",
				"chunk seven",
			],
		}));

		// Provide a deterministic embedding client
		const embed = {
			async embedTexts(texts: string[]) {
				if (texts.length === 1) return [[1, 0, 0]]; // query
				return texts.map((_, i) => [1 - i * 0.01, 0, 0]); // chunks
			},
		};

		// Mock gen to return bullets for map and a final paragraph for reduce
		setOllamaModuleLoaderForTests(() => ({
			gen: async (prompt: string) =>
				prompt.includes("Bullets:")
					? "Final paragraph."
					: "- insight\n- detail",
		}));

		const meta: Meta = {
			nameWithOwner: "owner/repo",
			url: "https://example.com",
			description: "lib",
			topics: ["x"],
		};

		const out = await summariseRepoOneParagraph(meta, { embed });
		expect(typeof out).toBe("string");
		expect(out.length).toBeGreaterThan(0);
	});

	it("uses one prompt snapshot throughout a summary operation", async () => {
		mock.module("@lib/readme", () => ({
			fetchReadmeWithCache: async () => "README",
			cleanMarkdown: (text: string) => text,
			chunkMarkdown: () => ["one chunk"],
		}));

		const config = (mapHeader: string, reduce: string) =>
			[
				"scoring:",
				'  system: "system"',
				'  fewshot: "examples"',
				"  criteria: |",
				"    ai = criterion",
				"summarise:",
				'  one_paragraph: "one paragraph"',
				`  map_header: "${mapHeader}"`,
				`  reduce: "${reduce}"`,
			].join("\n");
		const prompts: string[] = [];
		const meta: Meta = {
			nameWithOwner: "owner/repo",
			url: "https://example.com",
			description: "CLI utility",
		};

		await inTempDir(
			{ "prompts.yaml": config("FIRST MAP", "FIRST REDUCE") },
			async () => {
				await summariseRepoOneParagraph(meta, {
					gen: async (prompt) => {
						prompts.push(prompt);
						if (prompts.length === 1)
							writeFileSync(
								"prompts.yaml",
								config("UPDATED MAP", "UPDATED REDUCE"),
							);
						return prompts.length === 1 ? "- insight" : "summary";
					},
				});
			},
		);

		expect(prompts).toHaveLength(2);
		expect(prompts[0]).toContain("FIRST MAP");
		expect(prompts[1]).toContain("FIRST REDUCE");
		expect(prompts.join("\n")).not.toContain("UPDATED");
	});
});
