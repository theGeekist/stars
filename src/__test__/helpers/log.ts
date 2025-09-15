import { log as realLog } from "@lib/bootstrap";

type LogShape = typeof realLog;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableLog = Mutable<LogShape>;

export type Captured = {
	header: string[];
	subheader: string[];
	success: string[];
	warn: string[];
	error: string[];
	line: (string | undefined)[];
	list: unknown[][];
};

function makeStubs(c: Captured) {
	const header: LogShape["header"] = (title: string) => {
		c.header.push(title);
	};
	const subheader: LogShape["subheader"] = (title: string) => {
		c.subheader.push(title);
	};
	const success: LogShape["success"] = (...args) => {
		c.success.push(String(args[0] ?? ""));
	};
	const warn: LogShape["warn"] = (...args) => {
		c.warn.push(String(args[0] ?? ""));
	};
	const error: LogShape["error"] = (...args) => {
		c.error.push(String(args[0] ?? ""));
	};
	const line: LogShape["line"] = (s?: string) => {
		c.line.push(s);
		return true as ReturnType<LogShape["line"]>;
	};
	const list: LogShape["list"] = (items: string[]) => {
		c.list.push(items);
	};
	return { header, subheader, success, warn, error, line, list };
}

/** Run a block with bootstrap.log captured. Always restores. */
export async function withCapturedLog<T>(
	fn: (c: Captured) => Promise<T> | T,
): Promise<T> {
	const captured: Captured = {
		header: [],
		subheader: [],
		success: [],
		warn: [],
		error: [],
		line: [],
		list: [],
	};
	const original = {
		header: realLog.header,
		subheader: realLog.subheader,
		success: realLog.success,
		warn: realLog.warn,
		error: realLog.error,
		line: realLog.line,
		list: realLog.list,
	};

	const log = realLog as unknown as MutableLog;
	Object.assign(log, makeStubs(captured));
	try {
		return await fn(captured);
	} finally {
		Object.assign(log, original);
	}
}

// ------------------------------ Test loggers ------------------------------

import type { Spinner } from "@src/api/types";

/** Minimal logger with withSpinner and spinner; captures success() calls. */
export function makeLog(): {
	log: typeof realLog & {
		debug: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	succeedCalls: string[];
	successFn: (...args: unknown[]) => unknown;
} {
	const succeedCalls: string[] = [];
	const successFn = (...args: unknown[]) => {
		succeedCalls.push(String(args[0] ?? ""));
	};
	const stopFn = () => {};
	const log = {
		header: (_: string) => {},
		subheader: (_: string) => {},
		info: (..._args: unknown[]) => {},
		success: (msg: string) => successFn(msg),
		warn: (_: string) => {},
		error: (..._args: unknown[]) => {},
		line: (_?: string) => true,
		list: (_: string[]) => {},
		debug: (..._args: unknown[]) => {},
		spinner(_text: string) {
			return {
				start(): Spinner {
					return {
						text: _text,
						succeed: (m: string) => successFn(m),
						stop: () => stopFn(),
					} as Spinner;
				},
			};
		},
		async withSpinner<T>(_text: string, fn: () => T | Promise<T>): Promise<T> {
			return await fn();
		},
	} as unknown as typeof realLog & {
		debug: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	return { log, succeedCalls, successFn };
}

/** Logger capturing line() and success() calls. Includes debug/error no-ops. */
export function makeLogWithLines(): {
	log: typeof realLog & {
		debug: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	succeedCalls: string[];
	lineCalls: string[];
} {
	const succeedCalls: string[] = [];
	const lineCalls: string[] = [];
	const successFn = (msg: string) => {
		succeedCalls.push(msg);
	};
	const stopFn = () => {};
	const log = {
		header: (_: string) => {},
		subheader: (_: string) => {},
		info: (..._args: unknown[]) => {},
		success: (msg: string) => successFn(msg),
		warn: (_: string) => {},
		error: (..._args: unknown[]) => {},
		line: (msg?: string) => {
			lineCalls.push(String(msg));
			return true;
		},
		list: (_: string[]) => {},
		debug: (..._args: unknown[]) => {},
		spinner(_text: string) {
			return {
				start(): Spinner {
					return {
						text: _text,
						succeed: (m: string) => successFn(m),
						stop: () => stopFn(),
					} as Spinner;
				},
			};
		},
		async withSpinner<T>(_text: string, fn: () => T | Promise<T>): Promise<T> {
			return await fn();
		},
	} as unknown as typeof realLog & {
		debug: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	return { log, succeedCalls, lineCalls };
}

/** Rich capture logger for headers, infos, successes, spinner starts/succeeds. */
export function makeCaptureLog(): {
	log: typeof realLog & {
		debug: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	headers: string[];
	infos: string[];
	successes: string[];
	spinnerStarts: string[];
	spinnerSucceedMsgs: string[];
} {
	const headers: string[] = [];
	const infos: string[] = [];
	const successes: string[] = [];
	const spinnerStarts: string[] = [];
	const spinnerSucceedMsgs: string[] = [];
	const stopFn = () => {};
	const log = {
		header: (m: string) => headers.push(m),
		subheader: (_: string) => {},
		info: (m: string) => infos.push(m),
		success: (m: string) => successes.push(m),
		warn: (_: string) => {},
		error: (..._args: unknown[]) => {},
		line: (_?: string) => true,
		list: (_: string[]) => {},
		debug: (..._args: unknown[]) => {},
		spinner(text: string) {
			spinnerStarts.push(text);
			return {
				start(): Spinner {
					return {
						text,
						succeed: (m: string) => spinnerSucceedMsgs.push(m),
						stop: () => stopFn(),
					} as Spinner;
				},
			};
		},
		async withSpinner<T>(_text: string, fn: () => T | Promise<T>): Promise<T> {
			return await fn();
		},
	} as unknown as typeof realLog & {
		debug: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	return { log, headers, infos, successes, spinnerStarts, spinnerSucceedMsgs };
}

/** Logger without withSpinner for exercising utils.withSpinner fallback path. */
export function makeLiteLog(): { log: Omit<typeof realLog, "withSpinner"> } {
	const stopFn = () => {};
	const log = {
		header: (_: string) => {},
		subheader: (_: string) => {},
		info: (..._args: unknown[]) => {},
		success: (_: string) => {},
		warn: (_: string) => {},
		error: (..._args: unknown[]) => {},
		line: (_?: string) => true,
		list: (_: string[]) => {},
		spinner(_text: string) {
			return {
				start(): Spinner {
					return {
						text: _text,
						succeed: (_: string) => {},
						stop: () => stopFn(),
					} as Spinner;
				},
			};
		},
	} as unknown as Omit<typeof realLog, "withSpinner">;
	return { log };
}
