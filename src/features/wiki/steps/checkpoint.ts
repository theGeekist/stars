import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Step } from "../types.ts";

export function stepCheckpoint<T>(
	label: string,
	dir = ".wiki_runs",
): Step<T, T> {
	return (log) => async (doc) => {
		const runId =
			(doc as Record<string, unknown>).commitSha ||
			new Date().toISOString().replace(/[:.]/g, "-");
		const path = join(dir, String(runId), `outer_${label}.json`);
		await mkdir(join(dir, String(runId)), { recursive: true });
		await writeFile(path, JSON.stringify(doc, null, 2), "utf8");
		log.info?.(`checkpoint: ${path}`);
		return doc;
	};
}
