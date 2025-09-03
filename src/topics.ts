// src/topics.ts
import * as api from "@features/topics/api";
import * as svc from "@features/topics/service";
import type { Deps as ApiDeps } from "@features/topics/types";
import { log as realLog } from "@lib/bootstrap";

/** Minimal logger contracts (structural, not reinventing topic types). */
export type SpinnerHandle = {
	text: string;
	succeed(msg: string): void;
	stop(): void;
};
export type SpinnerController = { start(): SpinnerHandle };
export type LoggerLike = {
	header(msg: string): void;
	info(msg: string): void;
	success(msg: string): void;
	line(msg?: string): void;
	spinner(text: string): SpinnerController;
};

/** Combine your feature’s API deps with the service functions (typed via typeof). */
export type TopicsDeps = ApiDeps & {
	listRepoRefsFromDb: typeof svc.listRepoRefsFromDb;
	buildRepoRefs: typeof svc.buildRepoRefs;
	reconcileRowsAndCollectUniverse: typeof svc.reconcileRowsAndCollectUniverse;
	refreshStaleTopicMeta: typeof svc.refreshStaleTopicMeta;
};

export type EnrichOptions = { onlyActive?: boolean; ttlDays?: number };

export const defaultTopicsDeps: TopicsDeps = {
	// service fns
	listRepoRefsFromDb: svc.listRepoRefsFromDb,
	buildRepoRefs: svc.buildRepoRefs,
	reconcileRowsAndCollectUniverse: svc.reconcileRowsAndCollectUniverse,
	refreshStaleTopicMeta: svc.refreshStaleTopicMeta,
	// api fns (as per Deps)
	normalizeTopics: api.normalizeTopics,
	reconcileRepoTopics: api.reconcileRepoTopics,
	repoTopicsMany: api.repoTopicsMany,
	selectStaleTopics: api.selectStaleTopics,
	topicMetaMany: api.topicMetaMany,
	upsertTopic: api.upsertTopic,
	upsertTopicAliases: api.upsertTopicAliases,
	upsertTopicRelated: api.upsertTopicRelated,
};

/** Resolve runtime settings (typed). */
export function resolveEnrichRuntime(opts?: EnrichOptions): {
	ONLY_ACTIVE: boolean;
	TTL_DAYS: number;
	CONCURRENCY_REPOS: number;
} {
	const ONLY_ACTIVE = !!opts?.onlyActive;
	const TTL_DAYS =
		typeof opts?.ttlDays === "number"
			? opts.ttlDays
			: Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
	const CONCURRENCY_REPOS = Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);
	return { ONLY_ACTIVE, TTL_DAYS, CONCURRENCY_REPOS };
}

/** Core (DI for tests). */
export async function enrichAllRepoTopicsCore(
	deps: TopicsDeps,
	logger: LoggerLike,
	opts?: EnrichOptions,
): Promise<void> {
	const { ONLY_ACTIVE, TTL_DAYS, CONCURRENCY_REPOS } =
		resolveEnrichRuntime(opts);

	const rows = deps.listRepoRefsFromDb(ONLY_ACTIVE);
	if (rows.length === 0) {
		logger.info("No repositories found to enrich (check your DB).");
		return;
	}

	logger.header("Topics enrichment");
	logger.info(
		`Repos: ${rows.length}  •  Active only: ${ONLY_ACTIVE ? "yes" : "no"}  •  TTL: ${TTL_DAYS}d`,
	);

	// Phase 1
	let sp = logger
		.spinner(
			`Fetching topics for ${rows.length} repos (concurrency=${CONCURRENCY_REPOS})...`,
		)
		.start();

	const refs = deps.buildRepoRefs(rows);
	const topicsByRepo = deps.repoTopicsMany(refs, {
		concurrency: CONCURRENCY_REPOS,
	});
	sp.succeed(`Fetched topics for ${rows.length} repos`);

	// Phase 2
	sp = logger
		.spinner("Reconciling local mapping and collecting unique topics...")
		.start();
	const universe = deps.reconcileRowsAndCollectUniverse(
		rows,
		topicsByRepo,
		deps.normalizeTopics,
		deps.reconcileRepoTopics,
	);
	sp.succeed(`Reconciled. Unique topics discovered: ${universe.size}`);

	// Phase 3
	sp = logger
		.spinner(`Refreshing topic metadata (TTL=${TTL_DAYS}d)...`)
		.start();
	const refreshed = deps.refreshStaleTopicMeta(
		universe,
		TTL_DAYS,
		deps.selectStaleTopics,
		deps.topicMetaMany,
		deps.upsertTopic,
		deps.upsertTopicAliases,
		deps.upsertTopicRelated,
	);
	sp.succeed(`Refreshed metadata for ${refreshed} topics`);

	// Summary
	logger.success(
		`Topics enriched: repos=${rows.length}  unique_topics=${universe.size}  refreshed=${refreshed}`,
	);
}

/** Public API (unchanged). */
export async function enrichAllRepoTopics(opts?: EnrichOptions): Promise<void> {
	await enrichAllRepoTopicsCore(defaultTopicsDeps, realLog, opts);
}

// CLI entry (unchanged)
if (import.meta.main) {
	const onlyActive = Bun.argv.includes("--active");
	const ttlIdx = Bun.argv.indexOf("--ttl");
	const ttl =
		ttlIdx > -1 && Bun.argv[ttlIdx + 1]
			? Number(Bun.argv[ttlIdx + 1])
			: undefined;

	realLog.header("Topics: enrich");
	realLog.info(
		`onlyActive=${onlyActive}  ttlDays=${ttl ?? Number(Bun.env.TOPIC_TTL_DAYS ?? 30)}`,
	);

	await enrichAllRepoTopics({ onlyActive, ttlDays: ttl }).catch((e) => {
		realLog.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	});
}
