import { describe, expect, it } from "bun:test";
import { inTempDir, promptsYaml } from "@src/__test__/helpers/fs";
import { withCapturedLog } from "@src/__test__/helpers/log";
import {
	checkPromptsState,
	criteriaExamples,
	ensurePromptsReadyOrExit,
	printSetupStatus,
	showSetupHintIfNotReady,
} from "./prompts";

describe("criteriaExamples", () => {
	it("returns non-empty examples", () => {
		const ex = criteriaExamples();
		expect(Array.isArray(ex)).toBe(true);
		expect(ex.length).toBeGreaterThan(3);
		expect(ex.some((s) => /productivity/.test(s))).toBe(true);
	});

	it("returns a sane list (extra coverage)", () => {
		const ex = criteriaExamples();
		expect(ex.length).toBeGreaterThan(5);
		expect(ex.some((x) => /ai/i.test(x))).toBe(true);
	});
});

describe("checkPromptsState", () => {
	it("missing when prompts.yaml is absent", () =>
		inTempDir(null, () => {
			const s = checkPromptsState();
			expect(s).toEqual({ kind: "missing" });
		}));

	it("invalid when scoring.criteria missing", () =>
		inTempDir(
			{
				"prompts.yaml": [
					"scoring:",
					'  system: "x"',
					"summarise:",
					'  one_paragraph: "y"',
					"",
				].join("\n"),
			},
			() => {
				const s = checkPromptsState();
				expect(s.kind).toBe("invalid");
				if (s.kind === "invalid")
					expect(s.reason).toContain("missing scoring.criteria");
			},
		));

	it("invalid when criteria is not a block", () =>
		inTempDir(
			{
				"prompts.yaml": [
					"scoring:",
					"  criteria: not-a-block",
					"summarise:",
					'  one_paragraph: "x"',
					"",
				].join("\n"),
			},
			() => {
				const s = checkPromptsState();
				expect(s.kind).toBe("invalid");
				if (s.kind === "invalid") expect(s.reason).toContain("block string");
			},
		));

	it("incomplete when criteria block empty", () =>
		inTempDir({ "prompts.yaml": promptsYaml("") }, () => {
			const s = checkPromptsState();
			expect(s).toEqual({
				kind: "incomplete",
				placeholderCount: 0,
				criteriaLines: 0,
			});
		}));

	it("incomplete when placeholders present", () =>
		inTempDir(
			{
				"prompts.yaml": promptsYaml(
					[
						"# comment",
						"productivity = TODO: fill me",
						"ai = only score if primary focus is AI",
					].join("\n"),
				),
			},
			() => {
				const s = checkPromptsState();
				expect(s.kind).toBe("incomplete");
				if (s.kind === "incomplete") {
					expect(s.criteriaLines).toBe(2); // comment ignored
					expect(s.placeholderCount).toBe(1);
				}
			},
		));

	it("ready when criteria lines exist and no placeholders", () =>
		inTempDir(
			{
				"prompts.yaml": promptsYaml(
					[
						"productivity = only score if it saves time",
						"ai = only score if primary focus is AI",
					].join("\n"),
				),
			},
			() => {
				const s = checkPromptsState();
				expect(s.kind).toBe("ready");
				if (s.kind === "ready") expect(s.criteriaLines).toBe(2);
			},
		));

	it("trims CRLF and leading 4-space indent", () =>
		inTempDir(
			{
				"prompts.yaml": [
					"scoring:",
					"  criteria: |",
					"    productivity = saves time\r",
					"    ai = primary focus is AI\r",
					"summarise:",
					'  one_paragraph: "x"',
					"",
				].join("\n"),
			},
			() => {
				const s = checkPromptsState();
				expect(s.kind).toBe("ready");
				if (s.kind === "ready") expect(s.criteriaLines).toBe(2);
			},
		));
});

describe("print + UX", () => {
	it("printSetupStatus: ready | incomplete | invalid | missing", () =>
		withCapturedLog((c) => {
			printSetupStatus({ kind: "ready", criteriaLines: 7 });
			expect(c.success.some((s) => /ready \(7 criteria lines\)/.test(s))).toBe(
				true,
			);

			printSetupStatus({
				kind: "incomplete",
				placeholderCount: 2,
				criteriaLines: 5,
			});
			const msgP = c.warn.find(Boolean) || "";
			expect(msgP).toContain("incomplete");
			expect(msgP).toContain("5 criteria lines");
			expect(msgP).toContain("2 placeholders");

			printSetupStatus({
				kind: "incomplete",
				placeholderCount: 1,
				criteriaLines: 1,
			});
			const msgS = c.warn.reverse().find(Boolean) || "";
			expect(msgS).toContain("1 placeholder");
			expect(msgS).not.toContain("placeholders,");

			printSetupStatus({ kind: "invalid", reason: "boom" });
			expect(c.error.some((s) => /invalid: boom/.test(s))).toBe(true);

			printSetupStatus({ kind: "missing" });
			expect(c.error).toContain("prompts.yaml not found.");
		}));

	it("showSetupHintIfNotReady: early return when ready", async () =>
		inTempDir({ "prompts.yaml": promptsYaml("ai = ready") }, async () => {
			await withCapturedLog(async (c) => {
				await showSetupHintIfNotReady();
				expect(c.header.length).toBe(0);
			});
		}));

	it("showSetupHintIfNotReady: prints helpful steps when incomplete", async () =>
		inTempDir({ "prompts.yaml": promptsYaml("ai = TODO: later") }, async () => {
			await withCapturedLog(async (c) => {
				await showSetupHintIfNotReady();
				expect(c.header).toContain("Setup");
				expect(c.subheader).toContain("Run");
				expect(c.line).toContain("  gk-stars setup");
				expect(c.subheader).toContain("Or edit");
				expect(c.line).toContain("  <root>/prompts.yaml");
				expect(c.subheader).toContain("Criteria style examples");
				expect(c.list.length).toBeGreaterThan(0);
			});
		}));

	it("ensurePromptsReadyOrExit: returns when ready", () =>
		inTempDir({ "prompts.yaml": promptsYaml("ai = ok") }, () => {
			return withCapturedLog(() => {
				ensurePromptsReadyOrExit();
				// no errors
			});
		}));

	it("ensurePromptsReadyOrExit: exits (intercepted) when missing", () =>
		inTempDir(null, () => {
			return withCapturedLog(() => {
				const originalExit = process.exit;
				let _exitCode: number | null = null;
				process.exit = ((code?: number): never => {
					_exitCode = code ?? 0;
					throw new Error("__exit__");
				}) as typeof process.exit;

				try {
					ensurePromptsReadyOrExit();
					throw new Error("expected exit");
				} catch (e) {
					const msg = String(e);
					expect(msg).toContain("__exit__");
					// expect(_exitCode).toBe(1); // optional
				} finally {
					process.exit = originalExit;
				}
			});
		}));
});
