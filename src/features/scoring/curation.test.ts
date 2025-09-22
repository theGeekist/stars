import { describe, expect, it } from "bun:test";
import { CURATION_POLICY, DEFAULT_POLICY } from "./config";
import type { ScoreItem } from "./llm";
import { createScoringService } from "./service";

describe("curation mode", () => {
	const scoring = createScoringService();

	it("preserves manually curated lists unless extremely low scoring", () => {
		const current = ["productivity", "manual-list"];
		const scores: ScoreItem[] = [
			{ list: "productivity", score: 0.4 }, // Would normally be removed (< 0.7, > 0.3)
			{ list: "manual-list", score: 0.15 }, // Still above curation threshold (0.1)
			{ list: "ai", score: 0.8 }, // Should be added
		];

		const result = scoring.planTargets(current, scores, CURATION_POLICY);

		// Should keep manually curated lists even with mediocre scores
		expect(result.keep).toContain("productivity");
		expect(result.keep).toContain("manual-list");
		// Should add new high-scoring lists
		expect(result.add).toContain("ai");
		// Should not remove anything above curation threshold
		expect(result.remove).toHaveLength(0);
		// No review category in curation mode
		expect(result.review).toHaveLength(0);
	});

	it("removes lists that score extremely low (below curation threshold)", () => {
		const current = ["wrong-list", "good-list"];
		const scores: ScoreItem[] = [
			{ list: "wrong-list", score: 0.05 }, // Below 0.1 threshold
			{ list: "good-list", score: 0.2 }, // Above 0.1 threshold
			{ list: "ai", score: 0.8 }, // Should be added
		];

		const result = scoring.planTargets(current, scores, CURATION_POLICY);

		expect(result.keep).toContain("good-list");
		expect(result.add).toContain("ai");
		expect(result.remove).toContain("wrong-list");
		expect(result.review).toHaveLength(0);
	});

	it("behaves differently from default policy for low scores", () => {
		const current = ["productivity"];
		const scores: ScoreItem[] = [
			{ list: "productivity", score: 0.2 }, // Below default remove threshold (0.3), above curation threshold (0.1)
			{ list: "ai", score: 0.8 },
		];

		// Default policy would remove productivity (score 0.2 < remove threshold 0.3)
		const defaultResult = scoring.planTargets(current, scores, DEFAULT_POLICY);
		expect(defaultResult.keep).not.toContain("productivity");
		expect(defaultResult.remove).toContain("productivity");

		// Curation policy keeps productivity (score 0.2 > curation threshold 0.1)
		const curationResult = scoring.planTargets(
			current,
			scores,
			CURATION_POLICY,
		);
		expect(curationResult.keep).toContain("productivity");
		expect(curationResult.remove).not.toContain("productivity");
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
			CURATION_POLICY,
		);
		expect(defaultCurationResult.remove).toContain("borderline-list");

		// With lower threshold (0.05), should also remove (0.07 > 0.05 but still worth removing?)
		// Actually, let me test with 0.08 threshold - should keep (0.07 < 0.08 = remove)
		const removeResult = scoring.planTargets(current, scores, {
			...CURATION_POLICY,
			curationRemoveThreshold: 0.08,
		});
		expect(removeResult.remove).toContain("borderline-list");

		// With much lower threshold (0.01), should keep (0.07 > 0.01)
		const keepResult = scoring.planTargets(current, scores, {
			...CURATION_POLICY,
			curationRemoveThreshold: 0.01,
		});
		expect(keepResult.remove).not.toContain("borderline-list");
		expect(keepResult.keep).toContain("borderline-list");
	});
});
