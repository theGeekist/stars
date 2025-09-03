// src/ingest.test.ts
import { describe, expect, mock, test } from "bun:test";
import type { IngestReporter } from "@features/ingest/types";
import {
	createReporter,
	ingestCore,
	type LoggerLike,
	resolveSourceDir,
	type SpinnerLike,
} from "./ingest";

/** Typed fake logger using Bun's mock(), no `as any`. */
function makeLog(): {
	log: LoggerLike;
	succeedCalls: string[];
	successFn: ReturnType<typeof mock>;
} {
	const succeedCalls: string[] = [];

	// wrap mocks so property types stay exact
	const succeedFn = mock((msg: string) => {
		succeedCalls.push(msg);
	});
	const stopFn = mock(() => {});

	// factory returns a fresh spinner each time (good enough for our tests)
	const log: LoggerLike = {
		spinner(_text: string): SpinnerLike {
			return {
				text: "",
				succeed: (msg: string) => succeedFn(msg),
				stop: () => stopFn(),
			};
		},
		success: (msg: string) => succeedFn(msg),
		line: (_?: string) => {},
	};

	return { log, succeedCalls, successFn: succeedFn };
}

describe("resolveSourceDir", () => {
	test("arg > env > default", () => {
		const prev = Bun.env.EXPORTS_DIR;
		Bun.env.EXPORTS_DIR = "/env/exports";
		expect(resolveSourceDir("/arg/exports")).toBe("/arg/exports");
		Bun.env.EXPORTS_DIR = "/env/exports";
		expect(resolveSourceDir()).toBe("/env/exports");
		Bun.env.EXPORTS_DIR = undefined;
		expect(resolveSourceDir()).toBe("./exports");
		Bun.env.EXPORTS_DIR = prev;
	});
});

describe("createReporter", () => {
	test("tracks totals and logs final message (computed totals)", () => {
		const { log, succeedCalls } = makeLog();
		const { reporter, getTotals } = createReporter(log, "/fixtures");

		reporter.start(2);
		expect(getTotals()).toEqual({ lists: 2, repos: 0 });

		reporter.listStart(
			{ name: "A", isPrivate: false, file: "", listId: "A" },
			0,
			2,
			1,
		);
		reporter.listDone(
			{ name: "A", isPrivate: false, file: "", listId: "A" },
			1,
		);
		reporter.listStart(
			{ name: "B", isPrivate: false, file: "", listId: "B" },
			1,
			2,
			3,
		);
		reporter.listDone(
			{ name: "B", isPrivate: false, file: "", listId: "B" },
			3,
		);
		expect(getTotals()).toEqual({ lists: 2, repos: 4 });

		reporter.done({ lists: 2, repos: 4 }); // use computed totals
		expect(succeedCalls).toContain("Ingest complete: 2 lists, 4 repos");
	});

	test("done() honours provided totals", () => {
		const { log, succeedCalls } = makeLog();
		const { reporter } = createReporter(log, "/fixtures");

		reporter.start(10);
		reporter.listDone(
			{ name: "X", isPrivate: false, file: "", listId: "X" },
			1,
		);
		reporter.done({ lists: 3, repos: 7 });

		expect(succeedCalls).toContain("Ingest complete: 3 lists, 7 repos");
	});
});

describe("ingestCore", () => {
	test("calls service with resolved source and wires reporter", async () => {
		const { log, succeedCalls } = makeLog();

		let captured = "";
		const fakeService = mock(
			async (src: string, r: Required<IngestReporter>) => {
				captured = src;
				r.start(2);
				// we don’t need listStart/listDone for this assertion, but call them once to exercise wiring:
				r.listStart(
					{ name: "A", isPrivate: false, file: "", listId: "A" },
					0,
					2,
					1,
				);
				r.listDone({ name: "A", isPrivate: false, file: "", listId: "A" }, 1);
				r.done({ lists: 2, repos: 3 });
				return { lists: 0 };
			},
		);

		await ingestCore(fakeService, log, "/my/exports");

		expect(captured).toBe("/my/exports");
		expect(fakeService).toHaveBeenCalledTimes(1);
		expect(succeedCalls).toContain("Ingest complete: 2 lists, 3 repos");
	});

	test("uses env var when arg is absent", async () => {
		const { log, succeedCalls } = makeLog();
		const prev = Bun.env.EXPORTS_DIR;
		Bun.env.EXPORTS_DIR = "/env/exports";

		let captured = "";
		const fakeService = mock(
			async (src: string, r: Required<IngestReporter>) => {
				captured = src;
				r.start(0);
				r.done({ lists: 0, repos: 0 });
				return { lists: 0 };
			},
		);

		await ingestCore(fakeService, log);

		expect(captured).toBe("/env/exports");
		expect(succeedCalls).toContain("Ingest complete: 0 lists, 0 repos");

		Bun.env.EXPORTS_DIR = prev;
	});
});
