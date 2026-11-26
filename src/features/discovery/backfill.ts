import type { Database } from "bun:sqlite";
import type { RepoInfo } from "@lib/types";
import { createDiscoveryService, type CollectionSnapshot } from "./service";

export type CuratedSource = {
	repoId: string;
	nameWithOwner: string;
	topics: string[];
};
/** Sources must come from a complete, validated direct-curation snapshot. Failed reads retain old edges. */
export async function backfillCollections(
	db: Database,
	sources: CuratedSource[],
	adapter: {
		load(source: CuratedSource): Promise<CollectionSnapshot>;
		resolve(url: string): Promise<RepoInfo | null>;
	},
	onProgress?: (completed: number, total: number) => void,
) {
	const service = createDiscoveryService(db);
	const active = new Set(sources.map((s) => `github:${s.repoId}`));
	const failures: Array<{ source: string; error: string }> = [];
	let items = 0;
	for (const source of sources) {
		try {
			const snapshot = await adapter.load(source);
			if (snapshot.source !== `github:${source.repoId}`)
				throw new Error("Source identity mismatch");
			const result = await service.snapshot(snapshot, adapter.resolve);
			items += result.mentions;
			if (result.failed)
				failures.push({
					source: source.nameWithOwner,
					error: `${result.failed} target resolutions need retry`,
				});
		} catch (error) {
			failures.push({
				source: source.nameWithOwner,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		onProgress?.(sources.indexOf(source) + 1, sources.length);
	}
	const old = db
		.query<{ source: string }, []>(
			"SELECT DISTINCT source FROM discovery_edge WHERE source LIKE 'github:%'",
		)
		.all();
	for (const { source } of old)
		if (!active.has(source)) service.removeSource(source);
	return { sources: sources.length, items, failures };
}
