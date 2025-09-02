import { describe, it, expect, mock } from "bun:test";
import { summariseRepoOneParagraph } from "@features/summarise/llm";

describe("summariseRepoOneParagraph", () => {
	it("short-circuits awesome lists based on metadata", async () => {
		const meta = {
			nameWithOwner: "sindresorhus/awesome",
			url: "https://github.com/sindresorhus/awesome",
			description: "An awesome list",
			topics: ["awesome"],
		};
		const out = await summariseRepoOneParagraph(meta as any);
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
		mock.module("@lib/ollama", () => ({
			gen: async (_: string) => "This project is a tool that helps developers.",
		}));

		const meta = {
			nameWithOwner: "owner/repo",
			url: "https://example.com",
			description: "CLI utility",
			primaryLanguage: "TypeScript",
			topics: ["cli"],
		};
		const out = await summariseRepoOneParagraph(meta as any);
		expect(out).toContain("project");
	});

	it("uses embedding path with chunk selection (mocked)", async () => {
		// Mock readme with long content and chunker returning many chunks
		mock.module("@lib/readme", () => ({
			fetchReadmeWithCache: async () => "X".repeat(26000),
			cleanMarkdown: (s: string) => s + "\nIntro\n",
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
				// If it's the query (length 1), return a simple vector
				if (texts.length === 1) return [[1, 0, 0]];
				// For chunks, craft vectors so later chunks get slightly lower similarity
				return texts.map((_, i) => [1 - i * 0.01, 0, 0]);
			},
		};
		// Mock gen to return bullets for map and a final paragraph for reduce
		mock.module("@lib/ollama", () => ({
			gen: async (prompt: string) =>
				prompt.includes("Bullets:")
					? "Final paragraph."
					: "- insight\n- detail",
		}));

		const meta = {
			nameWithOwner: "owner/repo",
			url: "https://example.com",
			description: "lib",
			topics: ["x"],
		} as any;

		const out = await summariseRepoOneParagraph(meta, { embed });
		expect(typeof out).toBe("string");
		expect(out.length).toBeGreaterThan(0);
	});
});
