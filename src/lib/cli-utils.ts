// src/lib/cli-utils.ts
// Common CLI argument parsing utilities

import { parseSimpleArgs } from "./cli";

import type { BaseCliOptions } from "./types";

/** Parse common CLI options that appear across multiple commands */
export function parseCommonCliOptions(
	args: string[],
	startIndex = 1,
): BaseCliOptions {
	const options: BaseCliOptions = {};

	for (let i = startIndex; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--json":
				options.json = true;
				break;
			case "--dry":
				options.dry = true;
				break;
			case "--out":
				if (args[i + 1]) {
					i += 1;
					options.out = args[i];
				}
				break;
		}
	}

	return options;
}

/** Extract list name from --list argument */
export function parseListOption(args: string[]): string | undefined {
	const listIndex = args.indexOf("--list");
	if (listIndex > -1 && args[listIndex + 1]) {
		return args[listIndex + 1];
	}
	return undefined;
}

/** Extract numeric value from argument (e.g., --limit, --resume) */
export function parseNumericOption(
	args: string[],
	optionName: string,
): number | undefined {
	const index = args.indexOf(optionName);
	if (index > -1 && args[index + 1]) {
		const value = Number(args[index + 1]);
		return Number.isFinite(value) ? value : undefined;
	}
	return undefined;
}

/**
 * Check if a specific boolean flag is present in the arguments
 */
export function hasBooleanFlag(args: string[], flag: string): boolean {
	return args.includes(`--${flag}`);
}

/**
 * Parse command-line arguments for standard score/summarise commands
 */
export function parseStandardCommandArgs(argv: string[], args: string[]) {
	const s = parseSimpleArgs(argv);
	let dry = s.dry;
	const extraFlags: Record<string, boolean | string | number> = {};

	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--dry") {
			dry = true;
			continue;
		}
		// Handle flags that can be processed by callers
		if (a.startsWith("--")) {
			const nextArg = args[i + 1];
			if (nextArg && !nextArg.startsWith("--")) {
				extraFlags[a.slice(2)] = nextArg;
				i++; // Skip next arg since we consumed it
			} else {
				extraFlags[a.slice(2)] = true;
			}
		}
	}

	return { s, dry, extraFlags };
}

/**
 * Handle standard one/all mode execution pattern
 */
export function handleStandardMode<T extends { dry: boolean }>(
	s: ReturnType<typeof parseSimpleArgs>,
	options: T,
	handlers: {
		onOne: (selector: string, opts: T) => Promise<void>;
		onAll: (limit: number, opts: T) => Promise<void>;
		getLogMessage?: (limit: number, opts: T) => string;
	},
): Promise<void> {
	if (s.mode === "one") {
		if (!s.one) {
			throw new Error("--one requires a value");
		}
		return handlers.onOne(s.one, options);
	} else {
		const limit = Math.max(1, s.limit ?? 999999999);
		if (handlers.getLogMessage) {
			// Caller needs to handle logging themselves
		}
		return handlers.onAll(limit, options);
	}
}

/** Extract string value from argument */
export function parseStringOption(
	args: string[],
	optionName: string,
): string | undefined {
	const index = args.indexOf(optionName);
	if (index > -1 && args[index + 1]) {
		return args[index + 1];
	}
	return undefined;
}
