import { describe, expect, it } from "bun:test";
import { parseSimpleArgs } from "./cli";
import {
	hasBooleanFlag,
	parseCommonCliOptions,
	parseListOption,
	parseNumericOption,
	parseStringOption,
} from "./cli-utils";

describe("parseSimpleArgs", () => {
	const base = ["node", "script"]; // argv[0], argv[1]

	it("defaults to --all when no flags", () => {
		const s = parseSimpleArgs(base);
		expect(s).toEqual({
			mode: "all",
			one: undefined,
			limit: undefined,
			dry: false,
		});
	});

	it("parses --one <value>", () => {
		const s = parseSimpleArgs([...base, "--one", "owner/repo"]);
		expect(s.mode).toBe("one");
		expect(s.one).toBe("owner/repo");
		expect(s.limit).toBeUndefined();
		expect(s.dry).toBe(false);
	});

	it("parses --all with --limit N", () => {
		const s = parseSimpleArgs([...base, "--all", "--limit", "25"]);
		expect(s.mode).toBe("all");
		expect(s.limit).toBe(25);
	});

	it("ignores non-numeric --limit arg", () => {
		const s = parseSimpleArgs([...base, "--all", "--limit", "NaN"]);
		expect(s.mode).toBe("all");
		expect(s.limit).toBeUndefined();
	});

	it("handles --dry flag", () => {
		const s = parseSimpleArgs([...base, "--all", "--dry"]);
		expect(s.dry).toBe(true);
	});

	it("last flag wins for mode when both provided (keeps simple rules)", () => {
		const s = parseSimpleArgs([...base, "--all", "--one", "x/y"]);
		expect(s.mode).toBe("one");
		expect(s.one).toBe("x/y");
	});
});

describe("CLI Utilities", () => {
	describe("parseCommonCliOptions", () => {
		it("parses --json flag", () => {
			const options = parseCommonCliOptions(["cmd", "--json"]);
			expect(options.json).toBe(true);
		});

		it("parses --dry flag", () => {
			const options = parseCommonCliOptions(["cmd", "--dry"]);
			expect(options.dry).toBe(true);
		});

		it("parses --out with value", () => {
			const options = parseCommonCliOptions(["cmd", "--out", "output.json"]);
			expect(options.out).toBe("output.json");
		});

		it("parses multiple flags together", () => {
			const options = parseCommonCliOptions([
				"cmd",
				"--json",
				"--dry",
				"--out",
				"file.json",
			]);
			expect(options).toEqual({
				json: true,
				dry: true,
				out: "file.json",
			});
		});

		it("returns empty object when no flags present", () => {
			const options = parseCommonCliOptions(["cmd", "arg1", "arg2"]);
			expect(options).toEqual({});
		});

		it("skips --out when no value provided", () => {
			const options = parseCommonCliOptions(["cmd", "--out"]);
			expect(options.out).toBeUndefined();
		});
	});

	describe("parseListOption", () => {
		it("extracts list name from --list flag", () => {
			const listName = parseListOption(["cmd", "--list", "my-list"]);
			expect(listName).toBe("my-list");
		});

		it("returns undefined when --list not present", () => {
			const listName = parseListOption(["cmd", "--other", "value"]);
			expect(listName).toBeUndefined();
		});

		it("returns undefined when --list has no value", () => {
			const listName = parseListOption(["cmd", "--list"]);
			expect(listName).toBeUndefined();
		});
	});

	describe("parseNumericOption", () => {
		it("extracts numeric value from option", () => {
			const value = parseNumericOption(["cmd", "--limit", "42"], "--limit");
			expect(value).toBe(42);
		});

		it("returns undefined for non-numeric value", () => {
			const value = parseNumericOption(["cmd", "--limit", "abc"], "--limit");
			expect(value).toBeUndefined();
		});

		it("returns undefined when option not present", () => {
			const value = parseNumericOption(["cmd", "--other", "123"], "--limit");
			expect(value).toBeUndefined();
		});

		it("returns undefined when option has no value", () => {
			const value = parseNumericOption(["cmd", "--limit"], "--limit");
			expect(value).toBeUndefined();
		});
	});

	describe("parseStringOption", () => {
		it("extracts string value from option", () => {
			const value = parseStringOption(["cmd", "--name", "test"], "--name");
			expect(value).toBe("test");
		});

		it("returns undefined when option not present", () => {
			const value = parseStringOption(["cmd", "--other", "test"], "--name");
			expect(value).toBeUndefined();
		});

		it("returns undefined when option has no value", () => {
			const value = parseStringOption(["cmd", "--name"], "--name");
			expect(value).toBeUndefined();
		});
	});

	describe("hasBooleanFlag", () => {
		it("returns true when flag is present", () => {
			const hasFlag = hasBooleanFlag(["cmd", "--verbose", "arg"], "--verbose");
			expect(hasFlag).toBe(true);
		});

		it("returns false when flag is not present", () => {
			const hasFlag = hasBooleanFlag(["cmd", "--other", "arg"], "--verbose");
			expect(hasFlag).toBe(false);
		});
	});
});
