import type { Database } from "bun:sqlite";
import { log as realLog } from "@lib/bootstrap";
import type { RepoInfo, StarList } from "@lib/types";
import type { ProgressDetail, ProgressEmitter } from "./public.types";
import {
	ingestCore,
	ingestFromData,
	ingestListedFromGh,
	ingestUnlistedFromGh,
} from "./ingest";
import type { IngestReturn } from "./types";

type IngestPhase =
	| "ingesting:lists+unlisted"
	| "ingesting:lists"
	| "ingesting:unlisted"
	| "ingesting:memory";

type IngestProgress = ProgressEmitter<IngestPhase>;

const startDetail: ProgressDetail = { status: "start" };
const doneDetail: ProgressDetail = { status: "done" };

interface IngestBaseOptions {
	db?: Database;
	logger?: typeof realLog;
	onProgress?: IngestProgress;
}

/** Options for full list + unlisted ingestion from remote sources. */
export interface IngestOptions extends IngestBaseOptions {
	// NOTE: optional export directory if ingesting from prior on-disk export
	dir?: string;
}

/** Options for ingesting only list-backed repositories. */
export interface IngestListsOptions extends IngestBaseOptions {}

/** Options for ingesting only unlisted repositories. */
export interface IngestUnlistedOptions extends IngestBaseOptions {}

/** Options for ingesting data from memory without remote fetches. */
export interface IngestFromMemoryOptions extends IngestBaseOptions {}

/** Ingest both list-based and unlisted repositories (network + DB writes). */
export async function ingestAll(
	options: IngestOptions = {},
): Promise<IngestReturn> {
	const { db, dir, logger = realLog, onProgress } = options;
	await onProgress?.({
		phase: "ingesting:lists+unlisted",
		detail: startDetail,
	});
	const res = await ingestCore(db, logger, dir);
	await onProgress?.({ phase: "ingesting:lists+unlisted", detail: doneDetail });
	return res;
}

/** Ingest only repositories that appear inside GitHub Lists (no unlisted diff). */
export async function ingestListsOnly(
	options: IngestListsOptions = {},
): Promise<IngestReturn> {
	const { db, logger = realLog, onProgress } = options;
	await onProgress?.({ phase: "ingesting:lists", detail: startDetail });
	const res = await ingestListedFromGh(db, logger);
	await onProgress?.({ phase: "ingesting:lists", detail: doneDetail });
	return res;
}

/** Ingest only repositories that are starred but not present in any List. */
export async function ingestUnlistedOnly(
	options: IngestUnlistedOptions = {},
): Promise<IngestReturn> {
	const { db, logger = realLog, onProgress } = options;
	await onProgress?.({ phase: "ingesting:unlisted", detail: startDetail });
	const res = await ingestUnlistedFromGh(db, logger);
	await onProgress?.({ phase: "ingesting:unlisted", detail: doneDetail });
	return res;
}

/** Ingest from in-memory data (pre-fetched lists/unlisted) bypassing network calls. */
export function ingestFromMemory(
	lists: StarList[],
	unlisted?: RepoInfo[],
	options: IngestFromMemoryOptions = {},
) {
	const { db, logger = realLog, onProgress } = options;
	void onProgress?.({ phase: "ingesting:memory", detail: startDetail });
	const res = ingestFromData(lists, unlisted, db, logger);
	void onProgress?.({ phase: "ingesting:memory", detail: doneDetail });
	return res;
}
