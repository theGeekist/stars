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
});
