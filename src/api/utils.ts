// ./api/utils.ts

import * as fs from "node:fs";
import { join } from "node:path";
import type { IngestReporter } from "@features/ingest/types";
import type {
	EnrichOptions,
	FreshnessSources,
	IngestTotals,
	ListlessCsvRow,
	LoggerLike,
	PlanDisplay,
	Spinner,
} from "./types";

/* -----------------------------------------------------------------------------
 * ENV HELPERS
 * -------------------------------------------------------------------------- */

/** Parse a number from env with a typed fallback. */
export function getEnvNumber(name: string, fallback: number): number {
	const raw = (Bun.env as Record<string, string | undefined>)[name];
	if (raw == null || raw.trim() === "") return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

/** Throw if a required env var is missing. */
export function getEnvStringRequired(name: string, hint?: string): string {
	const v = (Bun.env as Record<string, string | undefined>)[name];
	if (!v) throw new Error(hint ?? `${name} missing`);
	return v;
}

/* -----------------------------------------------------------------------------
 * UX HELPERS
 * -------------------------------------------------------------------------- */

export function boolToYesNo(b: boolean): "yes" | "no" {
	return b ? "yes" : "no";
}

/** Thin wrapper so call-sites can import one helper. Uses logger’s native withSpinner. */
export async function withSpinner<T>(
	logger: LoggerLike,
	text: string,
	fn: () => T | Promise<T>,
): Promise<T> {
	const anyLogger = logger as unknown as {
		withSpinner?: typeof logger.withSpinner;
	};
	if (typeof anyLogger.withSpinner === "function") {
		return anyLogger.withSpinner<T>(text, fn);
	}
	// Fallback for lightweight test loggers: emulate with spinner()
	const sp = logger.spinner(text).start();
	try {
		const out = await fn();
		sp.succeed(text);
		return out;
	} catch (e) {
		sp.fail?.(text);
		throw e;
	}
}

/** Resolve runtime settings from options + env (exported for testing). */
export function resolveEnrichRuntime(opts?: EnrichOptions) {
	const ONLY_ACTIVE = !!opts?.onlyActive;
	const TTL_DAYS =
		typeof opts?.ttlDays === "number"
			? opts.ttlDays
			: getEnvNumber("TOPIC_TTL_DAYS", 30);
	const CONCURRENCY_REPOS = getEnvNumber("TOPIC_REPO_CONCURRENCY", 4);
	return { ONLY_ACTIVE, TTL_DAYS, CONCURRENCY_REPOS };
}

/* -----------------------------------------------------------------------------
 * TEXT / JSON HELPERS
 * -------------------------------------------------------------------------- */

/* -----------------------------------------------------------------------------
 * FILESYSTEM HELPERS (clean call-sites; overrides last for tests)
 * -------------------------------------------------------------------------- */

export function ensureDirExists(
	dir: string,
	_fs: Pick<typeof fs, "existsSync" | "mkdirSync"> = fs,
) {
	if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
}

export function writeJsonFile(
	filePath: string,
	data: unknown,
	_fs: Pick<typeof fs, "writeFileSync"> = fs,
) {
	_fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/** `list` -> `list.json` (slugged) */
export function listFilename(
	name: string,
	slug: (s: string) => string,
): string {
	const base = slug(name) || "list";
	return `${base}.json`;
}

/** `prefix-page-001.json` */
export function pageFilename(prefix: string, n: number): string {
	return `${prefix}-page-${String(n).padStart(3, "0")}.json`;
}

/* -----------------------------------------------------------------------------
 * HUMAN PRINTERS (structural logger)
 * -------------------------------------------------------------------------- */

export function printListsHuman(
	logger: LoggerLike,
	lists: Array<{
		name: string;
		isPrivate: boolean;
		repos: unknown[];
		description?: string | null;
	}>,
) {
	logger.header("Lists");
	logger.columns?.(
		lists.map((l) => ({
			Name: l.name,
			Vis: l.isPrivate ? "private" : "public",
			Items: String(l.repos.length),
			Description: l.description ?? "",
		})),
		["Name", "Vis", "Items", "Description"],
	);
}

export function printReposHuman(
	logger: LoggerLike,
	repos: Array<{ nameWithOwner: string; stars?: number | null; url: string }>,
) {
	logger.header("Repositories");
	logger.columns?.(
		repos.map((r) => ({
			Repository: r.nameWithOwner,
			"★": String(r.stars ?? ""),
			URL: r.url,
		})),
		["Repository", "★", "URL"],
	);
}

/* -----------------------------------------------------------------------------
 * SCORING HELPERS
 * -------------------------------------------------------------------------- */

export function csvEscape(s: string): string {
	return `"${s.replace(/"/g, '""')}"`;
}

export function chooseFreshnessSource(s: FreshnessSources): string | null {
	return (
		s.pushed_at ??
		s.last_commit_iso ??
		s.last_release_iso ??
		s.updated_at ??
		null
	);
}

export function appendHeaderIfMissing(
	filePath: string,
	header: string,
	_fs: Pick<typeof fs, "existsSync" | "appendFileSync"> = fs,
) {
	if (!_fs.existsSync(filePath)) _fs.appendFileSync(filePath, header, "utf8");
}

export function appendCsvRow(
	filePath: string,
	values: string[],
	_fs: Pick<typeof fs, "appendFileSync"> = fs,
) {
	_fs.appendFileSync(filePath, `${values.join(",")}\n`, "utf8");
}

export function writeListlessCsvRow(
	row: ListlessCsvRow,
	baseDir = Bun.env.LISTLESS_OUT_DIR || join(process.cwd(), "exports"),
) {
	const outDir = baseDir;
	const outFile = join(outDir, "listless.csv");
	ensureDirExists(outDir);
	appendHeaderIfMissing(
		outFile,
		"name_with_owner,url,current_slugs,scores_json,note\n",
	);
	appendCsvRow(outFile, [
		csvEscape(row.nameWithOwner),
		csvEscape(row.url),
		csvEscape(row.current.join("|")),
		csvEscape(row.scores),
		csvEscape(row.note),
	]);
}

export function showPlan(logger: LoggerLike, plan: PlanDisplay) {
	const { add, remove, review, fallbackUsed } = plan;
	if (add.length) logger.info("Suggest ADD   :", add.join(", "));
	if (remove.length) logger.info("Suggest REMOVE:", remove.join(", "));
	if (review.length) logger.info("Review        :", review.join(", "));
	if (fallbackUsed) {
		logger.warn?.(
			`fallback → using review '${fallbackUsed.list}' (${fallbackUsed.score.toFixed(2)}) to avoid listless`,
		);
	}
}

/* -----------------------------------------------------------------------------
 * INGEST HELPERS
 * -------------------------------------------------------------------------- */

export function resolveSourceDir(dir?: string): string {
	return dir ?? Bun.env.EXPORTS_DIR ?? "./exports";
}

/** Create a reporter with all methods present (Required<IngestReporter>). */
export function createIngestReporter(
	log: LoggerLike,
	source: string,
): {
	reporter: Required<IngestReporter>;
	getTotals: () => IngestTotals;
} {
	let spinner: Spinner = log.spinner("Reading index...").start();
	let totalLists = 0;
	let totalRepos = 0;

	const reporter: Required<IngestReporter> = {
		start(n: number) {
			totalLists = n;
			spinner.text = `Found ${n} lists in ${source}`;
			spinner.succeed(`Found ${n} lists in ${source}`);
			spinner = log.spinner("Preparing...").start();
		},
		listStart(meta: { name: string }, i: number, t: number, repoCount: number) {
			spinner.text = `[${i + 1}/${t}] ${meta.name} (${repoCount} repos)`;
		},
		listDone(meta: { name: string }, repoCount: number) {
			totalRepos += repoCount;
			spinner.succeed(`Imported ${meta.name} (${repoCount})`);
			spinner = log.spinner("Next...").start();
		},
		done({ lists, repos }: { lists?: number; repos?: number }) {
			spinner.stop();
			const L = lists ?? totalLists;
			const R = repos ?? totalRepos;
			log.success(`Ingest complete: ${L} lists, ${R} repos`);
			log.line("");
		},
	};

	return {
		reporter,
		getTotals: () => ({ lists: totalLists, repos: totalRepos }),
	};
}
