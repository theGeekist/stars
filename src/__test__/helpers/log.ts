import { log as realLog } from "@lib/bootstrap";
import {
	createFullCapturingLogger,
	createLineAndSuccessLogger,
	createLiteLogger,
	createSuccessCapturingLogger,
} from "./log-factory";

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

// Re-export the factory functions for backward compatibility with existing tests
export const makeLog = createSuccessCapturingLogger;
export const makeLogWithLines = createLineAndSuccessLogger;
export const makeCaptureLog = createFullCapturingLogger;
export const makeLiteLog = createLiteLogger;
