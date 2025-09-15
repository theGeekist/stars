import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeLiteLog } from "../__test__/helpers/log";
import {
	appendCsvRow,
	appendHeaderIfMissing,
	boolToYesNo,
	chooseFreshnessSource,
	getEnvNumber,
	getEnvStringRequired,
	listFilename,
	pageFilename,
	parseStringArray,
	withSpinner,
	writeListlessCsvRow,
} from "./utils";

describe("api utils", () => {
	test("env helpers parse and throw as expected", () => {
		const prev = Bun.env.MY_NUM;
		Bun.env.MY_NUM = "42";
		expect(getEnvNumber("MY_NUM", 7)).toBe(42);
		Bun.env.MY_NUM = "oops";
		expect(getEnvNumber("MY_NUM", 7)).toBe(7);
		Bun.env.MY_NUM = prev;

		expect(() => getEnvStringRequired("__NOPE__")).toThrow();
	});

	test("boolToYesNo + parseStringArray", () => {
		expect(boolToYesNo(true)).toBe("yes");
		expect(boolToYesNo(false)).toBe("no");
		expect(parseStringArray('["a",1,null]')).toEqual(["a"]);
		expect(parseStringArray("not json")).toEqual([]);
	});

	test("filenames helpers", () => {
		const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
		expect(listFilename("My List", slug)).toBe("my-list.json");
		expect(pageFilename("stars", 3)).toBe("stars-page-003.json");
	});

	test("withSpinner falls back when logger.withSpinner missing", async () => {
		const { log } = makeLiteLog();
		const out = await withSpinner(
			log as unknown as import("./types").LoggerLike,
			"work",
			() => Promise.resolve(123),
		);
		expect(out).toBe(123);
	});

	test("listless CSV writers", () => {
		const dir = mkdtempSync(join(tmpdir(), "api-utils-"));
		writeListlessCsvRow(
			{
				nameWithOwner: "o/r",
				url: "https://ex",
				current: ["a"],
				scores: "{}",
				note: "n",
			},
			dir,
		);
		const file = join(dir, "listless.csv");
		const csv = readFileSync(file, "utf8");
		expect(csv.split("\n")[0]).toContain("name_with_owner");

		// append helpers (hit direct lines)
		appendHeaderIfMissing(file, "header1\n"); // no-op because exists
		appendCsvRow(file, ["x", "y"]);
		const csv2 = readFileSync(file, "utf8");
		expect(csv2).toContain("x,y\n");
	});

	test("freshness choose order", () => {
		expect(chooseFreshnessSource({ pushed_at: "p" })).toBe("p");
		expect(chooseFreshnessSource({ last_commit_iso: "c" })).toBe("c");
		expect(chooseFreshnessSource({ last_release_iso: "r" })).toBe("r");
		expect(chooseFreshnessSource({ updated_at: "u" })).toBe("u");
		expect(
			chooseFreshnessSource(
				{} as unknown as import("./types").FreshnessSources,
			),
		).toBe(null);
	});
});
