// ./api/ingest.ts
import type { Database } from "bun:sqlite";
import { createIngestService } from "@features/ingest/service";
import type { IngestReporter } from "@features/ingest/types";
import { createStarsService } from "@features/stars";
import { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import { loadListsModule } from "@lib/lists-loader";
import type { RepoInfo, StarList } from "@lib/types";
import type { IngestReturn, TestLoggerLike } from "./types";
import {
	createIngestReporter,
	getEnvStringRequired,
	resolveSourceDir,
} from "./utils";

// Prod logger contract
type Logger = typeof realLog;

/**
 * Core (dependency-injectable for tests).
 * - Inject a Database (recommended in tests).
 * - Inject a custom logger (typeof realLog in prod; TestLoggerLike in tests).
 * - `dir` resolves via Bun env fallback.
 */
export async function ingestCore(
	db?: Database,
	log: Logger | TestLoggerLike = realLog,
	dir?: string,
): Promise<IngestReturn> {
	const source = resolveSourceDir(dir);
	const { reporter } = createIngestReporter(log, source);

	const service = createIngestService({ db });
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
	log: Logger | TestLoggerLike = realLog,
	dir?: string,
): Promise<void> {
	const source = resolveSourceDir(dir);
	const { reporter } = createIngestReporter(log, source);
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

/** Ingest from in-memory data (lists + optional unlisted) with automatic cleanup. */
export function ingestFromData(
	lists: StarList[],
	unlisted?: RepoInfo[],
	db?: Database,
	log: Logger | TestLoggerLike = realLog,
): { lists: number; reposFromLists: number; unlisted: number } {
	const source = "memory";
	const { reporter } = createIngestReporter(log, source);
	const service = createIngestService({ db });
	const res = service.ingestFromData(lists, unlisted, reporter);
	log.line(
		`Details: ${res.reposFromLists} repos via lists, ${res.unlisted} unlisted repos`,
	);
	if (res.cleanup.removed > 0) {
		log.line(
			`Cleanup: ${res.cleanup.removed} removed, ${res.cleanup.preserved} preserved with overrides`,
		);
	}
	log.line("");
	return {
		lists: res.lists,
		reposFromLists: res.reposFromLists,
		unlisted: res.unlisted,
	};
}

/** Fetch GitHub lists and ingest directly (no disk cache required). */
export async function ingestListedFromGh(
	db?: Database,
	log: Logger | TestLoggerLike = realLog,
	signal?: AbortSignal,
): Promise<IngestReturn> {
	const token = getEnvStringRequired(
		"GITHUB_TOKEN",
		"GITHUB_TOKEN missing. Add it to .env (Bun loads it automatically).",
	);
	const lists: StarList[] = [];
	const s = log.spinner("Fetching lists...").start();
	let total = 0;
	try {
		const { getAllListsStream } = loadListsModule();
		for await (const l of getAllListsStream(
			token,
			undefined,
			{
				debug: () => {},
			},
			signal,
		)) {
			if (signal?.aborted) throw new Error("Aborted");
			lists.push(l);
			total++;
			s.text = `Loaded list ${total}: ${l.name}`;
		}
		s.succeed(`Fetched ${total} lists`);
	} catch (e) {
		s.fail?.("Aborted");
		throw e;
	}

	const res = ingestFromData(lists, undefined, db, log);
	return {
		lists: res.lists,
		reposFromLists: res.reposFromLists,
		unlisted: res.unlisted,
	};
}

/** Compute unlisted from GitHub + DB and ingest them directly. */
export async function ingestUnlistedFromGh(
	db?: Database,
	log: Logger | TestLoggerLike = realLog,
	signal?: AbortSignal,
): Promise<IngestReturn> {
	const svc = createStarsService({ db: withDB(db) });
	const s = log.spinner("Computing unlisted stars...").start();
	let unlisted: RepoInfo[] = [];
	try {
		if (signal?.aborted) throw new Error("Aborted");
		unlisted = await svc.read.getUnlistedStars(signal);
		s.succeed(`Found ${unlisted.length} unlisted starred repositories`);
	} catch (e) {
		s.fail?.("Aborted");
		throw e;
	}

	const res = ingestFromData([], unlisted, db, log);
	return {
		lists: res.lists,
		reposFromLists: res.reposFromLists,
		unlisted: res.unlisted,
	};
}
