// src/lib/types/utilities.ts
// Common utility types used across the application

/** Basic reporter interface for debugging output */
export type Reporter = { debug: (...args: unknown[]) => void };

/** Logger type based on console/realLog pattern */
export type Logger = {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
};

/** Test-compatible logger interface */
export type LoggerLike = {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
};

/** Type alias for test logger compatibility */
export type TestLoggerLike = LoggerLike;

/** No-op reporter for silent operations */
export const NoopReporter: Reporter = { debug: () => {} };
