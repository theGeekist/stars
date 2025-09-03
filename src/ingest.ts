// src/ingest.ts
import { ingestFromExports as realIngestFromExports } from "@features/ingest/service";
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

/** Core (dependency-injectable for tests). */
export async function ingestCore(
	ingestFn: (
		source: string,
		r: Required<IngestReporter>,
	) => Promise<{ lists: number }> = realIngestFromExports,
	log: LoggerLike = realLog,
	dir?: string,
): Promise<void> {
	const source = resolveSourceDir(dir);
	const { reporter } = createReporter(log, source);
	await ingestFn(source, reporter);
}

/** Public API – unchanged. */
export default async function ingest(dir?: string): Promise<void> {
	return ingestCore(realIngestFromExports, realLog, dir);
}
