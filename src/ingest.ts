// src/ingest.ts
import type { Database } from "bun:sqlite";
import { createIngestService } from "@features/ingest/service";
import type { IngestReporter } from "@features/ingest/types";
import { log as realLog } from "@lib/bootstrap";

/** Minimal logger contract this file needs (structural). */
export type SpinnerLike = {
	text: string;
	succeed(msg: string): void;
	stop(): void;
};
export type LoggerLike = {
	spinner(text: string): SpinnerLike;
	success(msg: string): void;
	info?(msg: string): void; // optional – used if available
	line(msg?: string): void;
};

/** Resolve source directory with simple precedence. */
export function resolveSourceDir(dir?: string): string {
	return dir ?? Bun.env.EXPORTS_DIR ?? "./exports";
}

/** Create a reporter with all methods present (Required<IngestReporter>). */
export function createReporter(
	log: LoggerLike,
	source: string,
): {
	reporter: Required<IngestReporter>;
	getTotals: () => { lists: number; repos: number };
} {
	let spinner = log.spinner("Reading index...");
	let totalLists = 0;
	let totalRepos = 0;

	const reporter: Required<IngestReporter> = {
		start(n: number) {
			totalLists = n;
			spinner.text = `Found ${n} lists in ${source}`;
			spinner.succeed(`Found ${n} lists in ${source}`);
			spinner = log.spinner("Preparing...");
		},
		listStart(meta: { name: string }, i: number, t: number, repoCount: number) {
			spinner.text = `[${i + 1}/${t}] ${meta.name} (${repoCount} repos)`;
		},
		listDone(meta: { name: string }, repoCount: number) {
			totalRepos += repoCount;
			spinner.succeed(`Imported ${meta.name} (${repoCount})`);
			spinner = log.spinner("Next...");
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

/** New concrete return type from the service. */
type IngestReturn = { lists: number; reposFromLists: number; unlisted: number };

/**
 * Core (dependency-injectable for tests).
 * - You can inject a Database (recommended in tests).
 * - You can inject a custom logger.
 * - `dir` resolves via Bun env fallback.
 */
export async function ingestCore(
	db?: Database,
	log: LoggerLike = realLog,
	dir?: string,
): Promise<IngestReturn> {
	const source = resolveSourceDir(dir);
	const { reporter } = createReporter(log, source);

	const service = createIngestService(db);
	const result = await service.ingestFromExports(source, reporter);

	// Details line (concise)
	log.line(
		`Details: ${result.reposFromLists} repos via lists, ${result.unlisted} unlisted repos`,
	);
	log.line("");

	return result;
}

/** Test helper: legacy-injectable variant used by unit tests. */
export async function ingestCoreWith(
	ingestFn: (
		source: string,
		r: Required<IngestReporter>,
	) => Promise<
		| { lists: number }
		| { lists: number; reposFromLists: number; unlisted: number }
	>,
	log: LoggerLike = realLog,
	dir?: string,
): Promise<void> {
	const source = resolveSourceDir(dir);
	const { reporter } = createReporter(log, source);
	const result = await ingestFn(source, reporter);

	// reporter.done already printed the summary; add details line if present
	if ("unlisted" in result || "reposFromLists" in result) {
		const unlisted = "unlisted" in result ? result.unlisted : 0;
		const fromLists =
			"reposFromLists" in result ? result.reposFromLists : undefined;
		log.line(
			fromLists != null
				? `Details: ${fromLists} repos via lists, ${unlisted} unlisted repos`
				: `Details: ${unlisted} unlisted repos`,
		);
		log.line("");
	}
}

/** Public CLI entry – unchanged signature, uses default DB via service factory. */
export default async function ingest(dir?: string): Promise<void> {
	await ingestCore(undefined, realLog, dir);
}
