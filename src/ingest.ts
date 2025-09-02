// src/ingest.ts
import {
	type IngestReporter,
	ingestFromExports,
} from "@features/ingest/service";
import { log } from "@lib/bootstrap";

export default async function ingest(dir?: string): Promise<void> {
	const source = dir ?? Bun.env.EXPORTS_DIR ?? "./exports";

	let spinner = log.spinner("Reading index...");
	let totalLists = 0;
	let totalRepos = 0;

	const reporter: IngestReporter = {
		start(n) {
			totalLists = n;
			spinner.text = `Found ${n} lists in ${source}`;
			spinner.succeed(`Found ${n} lists in ${source}`);
			spinner = log.spinner("Preparing...");
		},
		listStart(meta, i, t, repoCount) {
			spinner.text = `[${i + 1}/${t}] ${meta.name} (${repoCount} repos)`;
		},
		listDone(meta, repoCount) {
			totalRepos += repoCount;
			spinner.succeed(`Imported ${meta.name} (${repoCount})`);
			spinner = log.spinner("Next...");
		},
		done({ lists, repos }) {
			spinner.stop();
			// Use the computed totals in case the service changes its return shape
			const L = lists ?? totalLists;
			const R = repos ?? totalRepos;
			log.success(`Ingest complete: ${L} lists, ${R} repos`);
			log.line(""); // spacer
		},
	};

	await ingestFromExports(source, reporter);
}
