import { jest } from "bun:test";
import type { Logger } from "@lib/logger";
import type { Spinner } from "@src/api/types";

type JestMockFn = ReturnType<typeof jest.fn>;

type MockedSpinner = Spinner & {
	succeed: JestMockFn;
	fail?: JestMockFn;
	stop: JestMockFn;
};

type LogMocks = {
	header: JestMockFn;
	subheader: JestMockFn;
	info: JestMockFn;
	success: JestMockFn;
	warn: JestMockFn;
	error: JestMockFn;
	debug: JestMockFn;
	line: JestMockFn;
	list: JestMockFn;
	json: JestMockFn;
	columns: JestMockFn;
	spinner: JestMockFn;
	spinnerStart: JestMockFn;
	withSpinner: JestMockFn;
};

function createSpinnerInstance(text: string): MockedSpinner {
	return {
		text,
		succeed: jest.fn(),
		fail: jest.fn(),
		stop: jest.fn(),
	};
}

export function createMockLogger(): { log: Logger; mocks: LogMocks } {
	const header = jest.fn();
	const subheader = jest.fn();
	const info = jest.fn();
	const success = jest.fn();
	const warn = jest.fn();
	const error = jest.fn();
	const debug = jest.fn();
	const line = jest.fn(() => true);
	const list = jest.fn();
	const json = jest.fn();
	const columns = jest.fn();

	const spinnerStart = jest.fn((text: string) => createSpinnerInstance(text));

	const spinnerFactory = jest.fn((text: string) => {
		const start = jest.fn(() => spinnerStart(text));
		return { start: start as () => Spinner };
	});

	const withSpinnerImpl = async (
		text: string,
		run: (s: Spinner) => unknown,
		opts?: { succeedText?: string; failText?: string },
	) => {
		const spinner = spinnerStart(text);
		try {
			const result = await run(spinner);
			spinner.succeed(opts?.succeedText ?? text);
			return result;
		} catch (error) {
			spinner.fail?.(opts?.failText ?? text);
			throw error;
		}
	};

	const withSpinner = jest.fn(withSpinnerImpl);

	const log = {
		header,
		subheader,
		info,
		success,
		warn,
		error,
		debug,
		line,
		list,
		json,
		columns,
		spinner: spinnerFactory,
		withSpinner: withSpinner as unknown as Logger["withSpinner"],
	} as unknown as Logger;

	return {
		log,
		mocks: {
			header,
			subheader,
			info,
			success,
			warn,
			error,
			debug,
			line,
			list,
			json,
			columns,
			spinner: spinnerFactory,
			spinnerStart,
			withSpinner,
		},
	};
}
