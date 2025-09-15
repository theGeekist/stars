import type { Database } from "bun:sqlite";
import { log as realLog } from "@lib/bootstrap";
import type { RepoInfo, StarList } from "@lib/types";
import {
	ingestCore,
	ingestFromData,
	ingestListedFromGh,
	ingestUnlistedFromGh,
} from "./ingest";
import type { IngestReturn } from "./types";

/** Options for full list + unlisted ingestion from remote sources. */
export interface IngestOptions {
	db?: Database;
	// NOTE: optional export directory if ingesting from prior on-disk export
	dir?: string;
	logger?: typeof realLog;
	onProgress?: (e: { phase: string; detail?: string }) => void;
}

/** Ingest both list-based and unlisted repositories (network + DB writes). */
export async function ingestAll(
	options: IngestOptions = {},
): Promise<IngestReturn> {
	const { db, dir, logger = realLog, onProgress } = options;
	onProgress?.({ phase: "ingest:lists+unlisted:start" });
	const res = await ingestCore(db, logger, dir);
	onProgress?.({ phase: "ingest:lists+unlisted:done" });
	return res;
}

/** Ingest only repositories that appear inside GitHub Lists (no unlisted diff). */
export async function ingestListsOnly(
	options: {
		db?: Database;
		logger?: typeof realLog;
		onProgress?: (e: { phase: string; detail?: string }) => void;
	} = {},
): Promise<IngestReturn> {
	const { db, logger = realLog, onProgress } = options;
	onProgress?.({ phase: "ingest:lists:start" });
	const res = await ingestListedFromGh(db, logger);
	onProgress?.({ phase: "ingest:lists:done" });
	return res;
}

/** Ingest only repositories that are starred but not present in any List. */
export async function ingestUnlistedOnly(
	options: {
		db?: Database;
		logger?: typeof realLog;
		onProgress?: (e: { phase: string; detail?: string }) => void;
	} = {},
): Promise<IngestReturn> {
	const { db, logger = realLog, onProgress } = options;
	onProgress?.({ phase: "ingest:unlisted:start" });
	const res = await ingestUnlistedFromGh(db, logger);
	onProgress?.({ phase: "ingest:unlisted:done" });
	return res;
}

/** Ingest from in-memory data (pre-fetched lists/unlisted) bypassing network calls. */
export function ingestFromMemory(
	lists: StarList[],
	unlisted?: RepoInfo[],
	options: {
		db?: Database;
		logger?: typeof realLog;
		onProgress?: (e: { phase: string; detail?: string }) => void;
	} = {},
) {
	const { db, logger = realLog, onProgress } = options;
	onProgress?.({ phase: "ingest:memory:start" });
	const res = ingestFromData(lists, unlisted, db, logger);
	onProgress?.({ phase: "ingest:memory:done" });
	return res;
}
