import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log as realLog } from "@lib/bootstrap";
import {
	checkPromptsState,
	criteriaExamples,
	ensurePromptsReadyOrExit,
	printSetupStatus,
	showSetupHintIfNotReady,
} from "./prompts";

function mkTempDir() {
	const d = join(
		process.cwd(),
		`.prompts-test-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(d, { recursive: true });
	return d;
}

let prevCwd: string;

beforeEach(() => {
	prevCwd = process.cwd();
});

afterEach(() => {
	process.chdir(prevCwd);
});

describe("criteriaExamples", () => {
	it("returns non-empty examples", () => {
		const ex = criteriaExamples();
		expect(Array.isArray(ex)).toBe(true);
		expect(ex.length).toBeGreaterThan(3);
		expect(ex.some((s) => /productivity/.test(s))).toBe(true);
	});
});

describe("checkPromptsState", () => {
	it("returns missing when prompts.yaml does not exist", () => {
		const dir = mkTempDir();
		process.chdir(dir);
		const s = checkPromptsState();
		expect(s).toEqual({ kind: "missing" });
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns invalid when scoring.criteria missing", () => {
		const dir = mkTempDir();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  system: "x"
summarise:
  one_paragraph: "y"
`.trim()}\n`,
		);
		const s = checkPromptsState();
		expect(s.kind).toBe("invalid");
		if (s.kind === "invalid") {
			expect(s.reason).toContain("missing scoring.criteria");
		}
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns invalid when criteria is not a block (missing '|')", () => {
		const dir = mkTempDir();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  criteria: not-a-block
summarise:
  one_paragraph: "x"
`.trim()}\n`,
		);
		const s = checkPromptsState();
		expect(s.kind).toBe("invalid");
		if (s.kind === "invalid") {
			expect(s.reason).toContain("block string");
		}
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns incomplete when criteria block is empty", () => {
		const dir = mkTempDir();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  criteria: |
summarise:
  one_paragraph: "x"
`.trim()}\n`,
		);
		const s = checkPromptsState();
		expect(s).toEqual({
			kind: "incomplete",
			placeholderCount: 0,
			criteriaLines: 0,
		});
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns incomplete when criteria has placeholders", () => {
		const dir = mkTempDir();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  criteria: |
    # comment
    productivity = TODO: fill me
    ai = only score if primary focus is AI
summarise:
  one_paragraph: "x"
`.trim()}\n`,
		);
		const s = checkPromptsState();
		expect(s.kind).toBe("incomplete");
		if (s.kind === "incomplete") {
			expect(s.criteriaLines).toBe(2); // comment ignored
			expect(s.placeholderCount).toBe(1);
		}
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns ready when criteria lines exist and no placeholders", () => {
		const dir = mkTempDir();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  criteria: |
    productivity = only score if it saves time
    ai = only score if primary focus is AI
summarise:
  one_paragraph: "x"
`.trim()}\n`,
		);
		const s = checkPromptsState();
		expect(s.kind).toBe("ready");
		if (s.kind === "ready") {
			expect(s.criteriaLines).toBe(2);
		}
		rmSync(dir, { recursive: true, force: true });
	});
});

function mkTemp() {
	const d = join(
		process.cwd(),
		`.prompts-test-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(d, { recursive: true });
	return d;
}

let captured = {
	header: [] as string[],
	subheader: [] as string[],
	success: [] as string[],
	warn: [] as string[],
	error: [] as string[],
	line: [] as (string | undefined)[],
	list: [] as unknown[][],
};

// --- types derived from the real value ---
type LogShape = typeof realLog;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableLog = Mutable<LogShape>;

let originalLog: Partial<LogShape> = {};

// Build stubs with the *exact* method types (no `any`)
function makeStubs() {
	const header: LogShape["header"] = (title: string) => {
		captured.header.push(title);
	};
	const subheader: LogShape["subheader"] = (title: string) => {
		captured.subheader.push(title);
	};
	const success: LogShape["success"] = (
		...args: Parameters<LogShape["success"]>
	) => {
		captured.success.push(String(args[0] ?? ""));
	};
	const warn: LogShape["warn"] = (...args: Parameters<LogShape["warn"]>) => {
		captured.warn.push(String(args[0] ?? ""));
	};
	const error: LogShape["error"] = (...args: Parameters<LogShape["error"]>) => {
		captured.error.push(String(args[0] ?? ""));
	};
	const line: LogShape["line"] = (s?: string) => {
		captured.line.push(s);
		// stdout.write returns boolean — keep the real signature
		return true as ReturnType<LogShape["line"]>;
	};
	const list: LogShape["list"] = (items: string[]) => {
		captured.list.push(items);
	};

	return { header, subheader, success, warn, error, line, list };
}

function stubLog() {
	// snapshot only what we override (typed precisely)
	originalLog = {
		header: realLog.header,
		subheader: realLog.subheader,
		success: realLog.success,
		warn: realLog.warn,
		error: realLog.error,
		line: realLog.line,
		list: realLog.list,
	};

	const log = realLog as unknown as MutableLog;
	Object.assign(log, makeStubs());
}

function restoreLog() {
	const log = realLog as unknown as MutableLog;
	Object.assign(log, originalLog);

	captured = {
		header: [],
		subheader: [],
		success: [],
		warn: [],
		error: [],
		line: [],
		list: [],
	};
}

beforeEach(() => {
	prevCwd = process.cwd();
	stubLog();
});

afterEach(() => {
	restoreLog();
	process.chdir(prevCwd);
});

describe("prompts — extra coverage", () => {
	it("criteriaExamples returns a sane list", () => {
		const ex = criteriaExamples();
		expect(ex.length).toBeGreaterThan(5);
		expect(ex.some((x) => /ai/i.test(x))).toBe(true);
	});

	it("printSetupStatus: ready", () => {
		printSetupStatus({ kind: "ready", criteriaLines: 7 });
		expect(
			captured.success.some((s) => /ready \(7 criteria lines\)/.test(s)),
		).toBe(true);
	});

	it("printSetupStatus: incomplete (pluralisation)", () => {
		printSetupStatus({
			kind: "incomplete",
			placeholderCount: 2,
			criteriaLines: 5,
		});
		const msg = captured.warn.find(Boolean) || "";
		expect(msg).toContain("incomplete");
		expect(msg).toContain("5 criteria lines");
		expect(msg).toContain("2 placeholders");
	});

	it("printSetupStatus: incomplete (singular)", () => {
		printSetupStatus({
			kind: "incomplete",
			placeholderCount: 1,
			criteriaLines: 1,
		});
		const msg = captured.warn.find(Boolean) || "";
		expect(msg).toContain("1 placeholder");
		expect(msg).not.toContain("placeholders,"); // simple check it’s singular
	});

	it("printSetupStatus: invalid", () => {
		printSetupStatus({ kind: "invalid", reason: "boom" });
		expect(captured.error.some((s) => /invalid: boom/.test(s))).toBe(true);
	});

	it("printSetupStatus: missing", () => {
		printSetupStatus({ kind: "missing" });
		expect(captured.error).toContain("prompts.yaml not found.");
	});

	it("showSetupHintIfNotReady: early-return when ready", () => {
		const dir = mkTemp();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  criteria: |
    ai = ready
summarise:
  one_paragraph: "x"
`.trim()}\n`,
		);
		// should not emit any header if ready
		return showSetupHintIfNotReady().then(() => {
			expect(captured.header.length).toBe(0);
			rmSync(dir, { recursive: true, force: true });
		});
	});

	it("showSetupHintIfNotReady: prints helpful steps when incomplete", async () => {
		const dir = mkTemp();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  criteria: |
    ai = TODO: later
summarise:
  one_paragraph: "x"
`.trim()}\n`,
		);

		await showSetupHintIfNotReady();

		// Emits the Setup header and guidance lines
		expect(captured.header).toContain("Setup");
		expect(captured.subheader).toContain("Run");
		expect(captured.line).toContain("  gk-stars setup");
		expect(captured.subheader).toContain("Or edit");
		expect(captured.line).toContain("  <root>/prompts.yaml");
		// shows examples list
		expect(captured.subheader).toContain("Criteria style examples");
		expect(captured.list.length).toBeGreaterThan(0);

		rmSync(dir, { recursive: true, force: true });
	});

	it("ensurePromptsReadyOrExit: returns when ready", () => {
		const dir = mkTemp();
		process.chdir(dir);
		writeFileSync(
			"prompts.yaml",
			`${`
scoring:
  criteria: |
    ai = ok
`.trim()}\n`,
		);

		// should not throw nor log errors
		ensurePromptsReadyOrExit();
		expect(captured.error.length).toBe(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("ensurePromptsReadyOrExit: exits (we intercept) when missing", () => {
		const dir = mkTemp();
		process.chdir(dir);

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
			// expect(exitCode).toBe(1);
			// It should have printed a status + final hint line
			expect(captured.error).toContain("prompts.yaml not found.");
			expect(captured.line).toContain(
				"Edit <root>/prompts.yaml or run: gk-stars setup",
			);
		} finally {
			process.exit = originalExit;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("checkPromptsState trims CRLF and leading 4-space indent", () => {
		const dir = mkTemp();
		process.chdir(dir);
		// Note CRLF and 4-space indent
		writeFileSync(
			"prompts.yaml",
			[
				"scoring:",
				"  criteria: |",
				"    productivity = saves time\r",
				"    ai = primary focus is AI\r",
				"summarise:",
				'  one_paragraph: "x"',
				"",
			].join("\n"),
		);
		const s = checkPromptsState();
		expect(s.kind).toBe("ready");
		if (s.kind === "ready") expect(s.criteriaLines).toBe(2);
		rmSync(dir, { recursive: true, force: true });
	});
});
