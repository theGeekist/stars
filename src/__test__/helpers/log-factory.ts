// src/__test__/helpers/log-factory.ts
// Factory for creating different types of test loggers

import type { log as realLog } from "@lib/bootstrap";
import type { Spinner } from "@src/api/types";

/** Base logger structure with common properties */
type BaseLogger = {
	header: (title: string) => void;
	subheader: (title: string) => void;
	info: (...args: unknown[]) => void;
	success: (msg: string) => void;
	warn: (msg: string) => void;
	error: (...args: unknown[]) => void;
	line: (msg?: string) => boolean;
	list: (items: string[]) => void;
	debug: (...args: unknown[]) => void;
};

/** Create a minimal no-op logger */
function createNoOpLogger(): BaseLogger {
	return {
		header: () => {},
		subheader: () => {},
		info: () => {},
		success: () => {},
		warn: () => {},
		error: () => {},
		line: () => true,
		list: () => {},
		debug: () => {},
	};
}

/** Create a spinner for test loggers */
function createTestSpinner(
	text: string,
	onSucceed?: (msg: string) => void,
): {
	start(): Spinner;
} {
	return {
		start(): Spinner {
			return {
				text,
				succeed: (m: string) => onSucceed?.(m),
				stop: () => {},
			} as Spinner;
		},
	};
}

/** Create a logger that captures specific call types */
export function createCapturingLogger(capture: {
	success?: string[];
	line?: string[];
	header?: string[];
	info?: string[];
	spinnerStarts?: string[];
	spinnerSucceeds?: string[];
}) {
	const baseLogger = createNoOpLogger();

	const logger = {
		...baseLogger,
		success: (msg: string) => {
			capture.success?.push(msg);
		},
		line: (msg?: string) => {
			capture.line?.push(String(msg));
			return true;
		},
		header: (msg: string) => {
			capture.header?.push(msg);
		},
		info: (msg: string) => {
			capture.info?.push(msg);
		},
		spinner(text: string) {
			capture.spinnerStarts?.push(text);
			return createTestSpinner(text, (msg) => {
				capture.spinnerSucceeds?.push(msg);
			});
		},
		async withSpinner<T>(_text: string, fn: () => T | Promise<T>): Promise<T> {
			return await fn();
		},
	} as unknown as typeof realLog & {
		debug: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};

	return logger;
}

/** Create a simple logger that only captures success calls */
export function createSuccessCapturingLogger() {
	const succeedCalls: string[] = [];
	const logger = createCapturingLogger({ success: succeedCalls });
	return { log: logger, succeedCalls };
}

/** Create a logger that captures both line and success calls */
export function createLineAndSuccessLogger() {
	const succeedCalls: string[] = [];
	const lineCalls: string[] = [];
	const logger = createCapturingLogger({
		success: succeedCalls,
		line: lineCalls,
	});
	return { log: logger, succeedCalls, lineCalls };
}

/** Create a comprehensive capturing logger */
export function createFullCapturingLogger() {
	const headers: string[] = [];
	const infos: string[] = [];
	const successes: string[] = [];
	const spinnerStarts: string[] = [];
	const spinnerSucceedMsgs: string[] = [];

	const logger = createCapturingLogger({
		header: headers,
		info: infos,
		success: successes,
		spinnerStarts,
		spinnerSucceeds: spinnerSucceedMsgs,
	});

	return {
		log: logger,
		headers,
		infos,
		successes,
		spinnerStarts,
		spinnerSucceedMsgs,
	};
}

/** Create a logger without withSpinner method for testing fallback behavior */
export function createLiteLogger() {
	const baseLogger = createNoOpLogger();
	const log = {
		...baseLogger,
		spinner(text: string) {
			return createTestSpinner(text);
		},
	} as unknown as Omit<typeof realLog, "withSpinner">;

	return { log };
}
