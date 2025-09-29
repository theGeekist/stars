// src/lib/cli-utils.ts
// Common CLI argument parsing utilities

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

/** Check if a boolean flag is present */
export function hasBooleanFlag(args: string[], flag: string): boolean {
	return args.includes(flag);
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
