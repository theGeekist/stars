// src/api/topics.ts
import * as api from "@features/topics/api";
import * as svc from "@features/topics/service";
import type { Deps as ApiDeps } from "@features/topics/types";
import { log as realLog } from "@lib/bootstrap";

import type { EnrichOptions } from "./types";
import { boolToYesNo, resolveEnrichRuntime } from "./utils";

/** Combine feature API deps with service fns (typed via typeof). */
export type TopicsDeps = ApiDeps & {
	listRepoRefsFromDb: typeof svc.listRepoRefsFromDb;
	buildRepoRefs: typeof svc.buildRepoRefs;
	reconcileRowsAndCollectUniverse: typeof svc.reconcileRowsAndCollectUniverse;
	refreshStaleTopicMeta: typeof svc.refreshStaleTopicMeta;
};

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

/* -------------------------- Phase helpers (exported for tests) -------------------------- */

/** Phase 1: build repo refs and fetch topics by repo. */
export function fetchTopicsForRepos(
	deps: TopicsDeps,
	rows: ReturnType<TopicsDeps["listRepoRefsFromDb"]>,
	concurrency: number,
) {
	const refs = deps.buildRepoRefs(rows);
	const topicsByRepo = deps.repoTopicsMany(refs, { concurrency });
	return { refs, topicsByRepo };
}

/** Phase 2: reconcile local mapping & collect unique topic universe. */
export function reconcileUniverse(
	deps: TopicsDeps,
	rows: ReturnType<TopicsDeps["listRepoRefsFromDb"]>,
	topicsByRepo: ReturnType<TopicsDeps["repoTopicsMany"]>,
) {
	const universe = deps.reconcileRowsAndCollectUniverse(
		rows,
		topicsByRepo,
		deps.normalizeTopics,
		deps.reconcileRepoTopics,
	);
	return universe;
}

/** Phase 3: refresh topic metadata based on TTL & upserts. */
export function refreshTopicMetadata(
	deps: TopicsDeps,
	universe: Set<string>,
	ttlDays: number,
) {
	const refreshed = deps.refreshStaleTopicMeta(
		universe,
		ttlDays,
		deps.selectStaleTopics,
		deps.topicMetaMany,
		deps.upsertTopic,
		deps.upsertTopicAliases,
		deps.upsertTopicRelated,
	);
	return refreshed;
}

/* ---------------------------------- Orchestration ---------------------------------- */

export async function enrichAllRepoTopicsCore(
	deps: TopicsDeps,
	logger: typeof realLog,
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
		`Repos: ${rows.length}  •  Active only: ${boolToYesNo(ONLY_ACTIVE)}  •  TTL: ${TTL_DAYS}d`,
	);

	// Phase 1
	let sp = logger
		.spinner(
			`Fetching topics for ${rows.length} repos (concurrency=${CONCURRENCY_REPOS})...`,
		)
		.start();
	const { topicsByRepo } = fetchTopicsForRepos(deps, rows, CONCURRENCY_REPOS);
	sp.succeed(`Fetching topics for ${rows.length} repos`);

	// Phase 2
	sp = logger
		.spinner("Reconciling local mapping and collecting unique topics...")
		.start();
	const universe = reconcileUniverse(deps, rows, topicsByRepo);
	sp.succeed(`Reconciled. Unique topics discovered: ${universe.size}`);

	// Phase 3
	sp = logger
		.spinner(`Refreshing topic metadata (TTL=${TTL_DAYS}d)...`)
		.start();
	const refreshed = refreshTopicMetadata(deps, universe, TTL_DAYS);
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
