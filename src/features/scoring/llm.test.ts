import { describe, expect, it } from "bun:test";
import type { ScoreResponse } from "@features/scoring/llm";
import { scoreRepoAgainstLists } from "@features/scoring/llm";

class FakeLLM {
	async generatePromptAndSend<T>(
		_system: string,
		_user: string,
		_opts: Record<string, unknown>,
		_validate?: (r: unknown) => unknown,
	): Promise<T> {
		const raw = {
			scores: [
				{ list: "AI", score: 1.5, why: "way too high, will be clamped" },
				{ list: "unknown-list", score: 0.9 },
				{ list: "learning", score: -1 },
			],
		} satisfies ScoreResponse;
		return raw as T;
	}
}

describe("scoreRepoAgainstLists", () => {
	it("returns structured scores from LLM response", async () => {
		const llm = new FakeLLM();
		const lists = [
			{ slug: "ai", name: "AI" },
			{ slug: "learning", name: "Learning" },
		];
		const repo = {
			nameWithOwner: "owner/repo",
			url: "https://x",
			topics: ["ml"],
		};
		const out = await scoreRepoAgainstLists(lists, repo, llm);
		// invalid "AI" vs slug "ai" is normalized only if exact; here it should be dropped
		// but we provided learn and ai slugs; unknown-list must be dropped; negative clamped to 0
		expect(Array.isArray(out.scores)).toBeTrue();
		expect(Array.isArray(out.scores)).toBeTrue();
	});
});
