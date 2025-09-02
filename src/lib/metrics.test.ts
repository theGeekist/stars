import { describe, expect, it } from "bun:test";
import { compareAlpha } from "@lib/utils";
import {
	chooseFreshnessSource,
	deriveTags,
	scoreActiveness,
	scoreFreshnessFromISO,
	scorePopularity,
} from "./metrics";

describe("metrics: deriveTags", () => {
	it("combines topics, lang, license and flags without duplicates", () => {
		const tags = deriveTags({
			topics: ["ml", "Ml", ""],
			primary_language: "TS",
			license: "MIT",
			is_archived: true,
			is_fork: true,
			is_mirror: false,
		});
		expect(tags.sort(compareAlpha)).toEqual(
			["archived", "fork", "license:mit", "lang:ts", "Ml", "ml"].sort(
				compareAlpha,
			),
		);
	});
});

describe("metrics: scorePopularity", () => {
	it("returns 0 for tiny repos and logs when s==0", () => {
		const logs: string[] = [];
		const orig = console.log;
		(console as unknown as { log: (...args: unknown[]) => void }).log = (
			...args: unknown[]
		) => {
			logs.push(args.map(String).join(" "));
		};
		const s = scorePopularity(0, 0, 0, () => {});
		(console as unknown as { log: typeof orig }).log = orig;
		expect(s).toBe(0);
		expect(logs.join("\\n")).toContain("popularity dbg");
	});

	it("caps at 1 for gigantic repos and logs when s==1", () => {
		const logs: string[] = [];
		const orig = console.log;
		(console as unknown as { log: (...args: unknown[]) => void }).log = (
			...args: unknown[]
		) => {
			logs.push(args.map(String).join(" "));
		};
		const s = scorePopularity(150000, 50000, 10000, () => {});
		(console as unknown as { log: typeof orig }).log = orig;
		expect(s).toBe(1);
		expect(logs.join("\\n")).toContain("popularity dbg");
	});
});

describe("metrics: scoreFreshnessFromISO", () => {
	it("returns 0 for missing or invalid dates", () => {
		expect(scoreFreshnessFromISO(null)).toBe(0);
		expect(scoreFreshnessFromISO("not-a-date")).toBe(0);
	});

	it("logs and computes linear branch for < 1y", () => {
		const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
		const orig = console.log;
		const logs: string[] = [];
		(console as unknown as { log: (...args: unknown[]) => void }).log = (
			...args: unknown[]
		) => {
			logs.push(args.map(String).join(" "));
		};
		const v = scoreFreshnessFromISO(tenDaysAgo, 90);
		(console as unknown as { log: typeof orig }).log = orig;
		expect(v).toBeGreaterThan(0.9);
		expect(logs.join("\\n")).toContain("freshness<1y");
	});

	it("logs and computes half-life branch for > 1y", () => {
		const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString();
		const orig = console.log;
		const logs: string[] = [];
		(console as unknown as { log: (...args: unknown[]) => void }).log = (
			...args: unknown[]
		) => {
			logs.push(args.map(String).join(" "));
		};
		const v = scoreFreshnessFromISO(twoYearsAgo, 90);
		(console as unknown as { log: typeof orig }).log = orig;
		expect(v).toBeGreaterThan(0);
		expect(v).toBeLessThan(0.5);
		expect(logs.join("\\n")).toContain("freshness>1y");
	});
});

describe("metrics: chooseFreshnessSource", () => {
	it("prefers pushedAt, then lastCommitISO, then lastReleaseISO, then updatedAt", () => {
		const dates = {
			pushedAt: "P",
			lastCommitISO: "C",
			lastReleaseISO: "R",
			updatedAt: "U",
		};
		expect(chooseFreshnessSource(dates)).toBe("P");
		expect(chooseFreshnessSource({ ...dates, pushedAt: undefined })).toBe("C");
		expect(
			chooseFreshnessSource({
				...dates,
				pushedAt: undefined,
				lastCommitISO: undefined,
			}),
		).toBe("R");
		expect(
			chooseFreshnessSource({
				...dates,
				pushedAt: undefined,
				lastCommitISO: undefined,
				lastReleaseISO: undefined,
			}),
		).toBe("U");
	});
});

describe("metrics: scoreActiveness", () => {
	it("blends backlog and push recency, clamps to [0,1]", () => {
		const recent = new Date(Date.now() - 7 * 86400000).toISOString();
		const s = scoreActiveness(10, 5, recent, {
			hasIssuesEnabled: true,
			isArchived: false,
		});
		expect(s).toBeGreaterThan(0);
		expect(s).toBeLessThanOrEqual(1);
	});

	it("penalizes when issues disabled and when archived", () => {
		const date = new Date(Date.now() - 30 * 86400000).toISOString();
		const base = scoreActiveness(5, 2, date, {
			hasIssuesEnabled: true,
			isArchived: false,
		});
		const issuesOff = scoreActiveness(5, 2, date, {
			hasIssuesEnabled: false,
			isArchived: false,
		});
		const archived = scoreActiveness(5, 2, date, {
			hasIssuesEnabled: true,
			isArchived: true,
		});
		expect(issuesOff).toBeLessThan(base);
		expect(archived).toBeLessThan(base);
	});
});
