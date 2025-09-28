import { describe, expect, it } from "bun:test";
import { DEFAULT_POLICY } from "./config";
import type { ScoreItem } from "./llm";
import { createScoringService } from "./service";

describe("curation mode", () => {
	const scoring = createScoringService();

	it("preserves manually curated lists unless extremely low scoring", () => {
		const current = ["productivity", "manual-list"];
		const scores: ScoreItem[] = [
			{ list: "productivity", score: 0.4 }, // below add threshold but above removal cutoff
			{ list: "manual-list", score: 0.25 }, // above default curationRemoveThreshold (0.2)
			{ list: "ai", score: 0.8 },
		];

		const result = scoring.planTargets(current, scores, DEFAULT_POLICY);

		expect(result.keep).toEqual(
			expect.arrayContaining(["productivity", "manual-list"]),
		);
		expect(result.add).toContain("ai");
		expect(result.remove).toHaveLength(0);
		expect(result.review).toHaveLength(0);
	});

	it("removes lists that score extremely low (below curation threshold)", () => {
		const current = ["wrong-list", "good-list"];
		const scores: ScoreItem[] = [
			{ list: "wrong-list", score: 0.05 }, // Below 0.1 threshold
			{ list: "good-list", score: 0.2 }, // Above 0.1 threshold
			{ list: "ai", score: 0.8 }, // Should be added
		];

		const result = scoring.planTargets(current, scores, DEFAULT_POLICY);

		expect(result.keep).toContain("good-list");
		expect(result.add).toContain("ai");
		expect(result.remove).toContain("wrong-list");
		expect(result.review).toHaveLength(0);
	});

	it("allows custom curation threshold to override default", () => {
		const current = ["productivity"];
		const scores: ScoreItem[] = [
			{ list: "productivity", score: 0.15 }, // Between default threshold (0.2) and lower threshold (0.1)
			{ list: "ai", score: 0.8 },
		];

		// Default policy removes productivity (score 0.15 < default threshold 0.2)
		const defaultResult = scoring.planTargets(current, scores, DEFAULT_POLICY);
		expect(defaultResult.keep).not.toContain("productivity");
		expect(defaultResult.remove).toContain("productivity");

		// Lower curation threshold keeps productivity (score 0.15 > custom threshold 0.1)
		const customResult = scoring.planTargets(current, scores, {
			...DEFAULT_POLICY,
			curationRemoveThreshold: 0.1,
		});
		expect(customResult.keep).toContain("productivity");
		expect(customResult.remove).not.toContain("productivity");
	});

	it("respects custom curation remove threshold", () => {
		const current = ["borderline-list"];
		const scores: ScoreItem[] = [
			{ list: "borderline-list", score: 0.07 }, // Between 0.05 and 0.1
		];

		// With default threshold (0.1), should remove (0.07 < 0.1)
		const defaultCurationResult = scoring.planTargets(
			current,
			scores,
			DEFAULT_POLICY,
		);
		expect(defaultCurationResult.remove).toContain("borderline-list");

		// With lower threshold (0.05), should also remove (0.07 > 0.05 but still worth removing?)
		// Actually, let me test with 0.08 threshold - should keep (0.07 < 0.08 = remove)
		const removeResult = scoring.planTargets(current, scores, {
			...DEFAULT_POLICY,
			curationRemoveThreshold: 0.08,
		});
		expect(removeResult.remove).toContain("borderline-list");

		// With much lower threshold (0.01), should keep (0.07 > 0.01)
		const keepResult = scoring.planTargets(current, scores, {
			...DEFAULT_POLICY,
			curationRemoveThreshold: 0.01,
		});
		expect(keepResult.remove).not.toContain("borderline-list");
		expect(keepResult.keep).toContain("borderline-list");
	});
});
