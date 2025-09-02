import { describe, expect, it } from "bun:test";
import {
	cosine,
	enforceWordCap,
	formatNum,
	isAwesomeList,
	isObject,
	linkDensity,
	parseJsonArray,
	parseStringArray,
	slugify,
	summariseAwesomeList,
	toNum,
	wordCount,
} from "./utils";

describe("utils", () => {
	it("isObject narrows plain objects", () => {
		expect(isObject({ a: 1 })).toBeTrue();
		expect(isObject(null)).toBeFalse();
		expect(isObject(1)).toBeFalse();
	});

	it("slugify produces lowercase dash-separated id", () => {
		expect(slugify("Hello, World!")).toBe("hello-world");
		expect(slugify(" already-slug ")).toBe("already-slug");
	});

	it("parseJsonArray handles invalid and valid input", () => {
		expect(parseJsonArray('[1, "a", null]')).toEqual(["a"]);
		expect(parseJsonArray("not json")).toEqual([]);
		expect(parseJsonArray(123 as unknown)).toEqual([]);
		expect(parseJsonArray("")).toEqual([]);
	});

	it("toNum parses numbers and trims strings", () => {
		expect(toNum(42)).toBe(42);
		expect(toNum(" 3.14 ")).toBeCloseTo(3.14);
		expect(toNum("x")).toBeNull();
	});

	it("parseStringArray returns only strings and tolerates bad json", () => {
		expect(parseStringArray('["a", 1, "b"]')).toEqual(["a", "b"]);
		expect(parseStringArray("{oops}")).toEqual([]);
		expect(parseStringArray(null)).toEqual([]);
	});

	it("formatNum formats thousands with k suffix", () => {
		expect(formatNum(null)).toBe("-");
		expect(formatNum(999)).toBe("999");
		expect(formatNum(1500)).toBe("1.5k");
		expect(formatNum(12000)).toBe("12k");
	});

	it("wordCount and enforceWordCap work together", () => {
		const s = "one two three";
		expect(wordCount(s)).toBe(3);
		const capped = enforceWordCap("a b c d e", 3);
		expect(wordCount(capped)).toBe(3);
		expect(/[.!?]$/.test(capped)).toBeTrue();
	});

	it("linkDensity counts lines with markdown links or URLs", () => {
		const text = [
			"no link here",
			"a [link](http://x) present",
			"https://example.com inline",
			"another line",
		].join("\n");
		expect(linkDensity(text)).toBeCloseTo(0.5, 1);
	});

	it("cosine similarity returns 1 for equal vectors and ~0 for orthogonal", () => {
		expect(cosine([1, 2], [1, 2])).toBeCloseTo(1, 6);
		expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
	});

	it("isAwesomeList detects via metadata and README", () => {
		expect(isAwesomeList("user/awesome-thing", "", ["tools"])).toBeTrue();
		expect(isAwesomeList("user/repo", "", ["awesome-list"])).toBeTrue();
		expect(isAwesomeList("user/repo", "", [], "# Awesome Python")).toBeTrue();
		expect(isAwesomeList("user/repo", "lib", ["misc"])).toBeFalse();
	});

	it("summariseAwesomeList composes a stable paragraph and caps words", () => {
		const out = summariseAwesomeList(
			"A list of ML things",
			["awesome", "ml", "ai"],
			40,
		);
		expect(wordCount(out)).toBeLessThanOrEqual(40);
		expect(typeof out).toBe("string");
		expect(out.length).toBeGreaterThan(10);
	});
});
