import { describe, expect, it } from "bun:test";
import { parseSimpleArgs } from "./cli";

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
