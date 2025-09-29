// src/lib/common.ts

import type { Reporter } from "./types";
import { NoopReporter } from "./types/utilities";

// Re-export for backward compatibility
export { NoopReporter };
export type { Reporter };

/** Clamp helper (e.g., for page size bounds) */
export function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n));
}

/** Resolve a paging config from env with overridable var names and defaults */
export function resolvePagingConfig(
	env: Record<string, string | undefined> = Bun.env,
	opts?: {
		pageSizeVar?: string; // e.g. "STARS_PAGE_SIZE"
		concurrencyVar?: string; // e.g. "STARS_CONCURRENCY"
		defaultPageSize?: number; // default 25
		minPageSize?: number; // default 10
		maxPageSize?: number; // default 100
		debugVar?: string; // default "DEBUG"
	},
) {
	const {
		pageSizeVar = "PAGE_SIZE",
		concurrencyVar = "CONCURRENCY",
		defaultPageSize = 30,
		minPageSize = 10,
		maxPageSize = 100,
		debugVar = "DEBUG",
	} = opts ?? {};

	const pageSize = clamp(
		Number(env[pageSizeVar] ?? defaultPageSize),
		minPageSize,
		maxPageSize,
	);
	const concurrency = Number(env[concurrencyVar] ?? 3);
	const debug = !!env[debugVar];

	return { pageSize, concurrency, debug };
}

/** Debug-print the effective env for a module */
export function debugEnv(
	label: string,
	cfg: { pageSize: number; concurrency: number; debug: boolean },
	reporter: Reporter = NoopReporter,
) {
	const { debug } = reporter;
	debug(`${label}: env`, {
		DEBUG: String(cfg.debug),
		CONCURRENCY: String(cfg.concurrency),
		PAGE_SIZE: String(cfg.pageSize),
	});
}

/** small bounded parallel map */
export async function pMap<T, R>(
	input: T[],
	concurrency: number,
	fn: (value: T, index: number) => Promise<R>,
	reporter: Reporter = NoopReporter,
): Promise<R[]> {
	const { debug } = reporter;
	const results: R[] = new Array(input.length) as R[];
	let i = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, input.length) },
		async (_, w) => {
			debug?.(`pMap: worker#${w} start`);
			for (;;) {
				const idx = i++;
				if (idx >= input.length) {
					debug?.(`pMap: worker#${w} done`);
					return;
				}
				debug?.(`pMap: worker#${w} running index=${idx}`);
				results[idx] = await fn(input[idx], idx);
			}
		},
	);
	await Promise.all(workers);
	return results;
}
