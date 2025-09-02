// src/enrich-topics.ts

import * as api from "@features/topics/api";
import {
	buildRepoRefs,
	listRepoRefsFromDb,
	reconcileRowsAndCollectUniverse,
	refreshStaleTopicMeta,
} from "@features/topics/service";
import { log } from "@lib/bootstrap";

/**
 * Enrich topics for all repos with pretty CLI output.
 * Mirrors the service flow, but adds spinners & a readable summary.
 */
export async function enrichAllRepoTopics(opts?: {
	onlyActive?: boolean;
	ttlDays?: number;
}): Promise<void> {
	const ONLY_ACTIVE = !!opts?.onlyActive;
	const TTL_DAYS = opts?.ttlDays ?? Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
	const CONCURRENCY_REPOS = Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);
	const CONCURRENCY_META = Number(Bun.env.TOPIC_META_CONCURRENCY ?? 3);

	// Phase 0 — sanity & repo selection
	const token = Bun.env.GITHUB_TOKEN ?? "";
	if (!token) {
		log.error("GITHUB_TOKEN not set");
		process.exit(1);
	}

	const rows = listRepoRefsFromDb(ONLY_ACTIVE);
	if (!rows.length) {
		log.info("No repositories found to enrich (check your DB).");
		return;
	}

	log.header("Topics enrichment");
	log.info(
		`Repos: ${rows.length}  •  Active only: ${ONLY_ACTIVE ? "yes" : "no"}  •  TTL: ${TTL_DAYS}d`,
	);

	// Phase 1 — fetch topics from GitHub (batched)
	let sp = log
		.spinner(
			`Fetching topics for ${rows.length} repos (concurrency=${CONCURRENCY_REPOS})...`,
		)
		.start();

	const refs = buildRepoRefs(rows);
	const topicsByRepo = await api.repoTopicsMany(token, refs, {
		concurrency: CONCURRENCY_REPOS,
	});

	sp.succeed(`Fetched topics for ${rows.length} repos`);

	// Phase 2 — reconcile + collect universe
	sp = log
		.spinner("Reconciling local mapping and collecting unique topics...")
		.start();

	const universe = reconcileRowsAndCollectUniverse(
		rows,
		topicsByRepo,
		api.normalizeTopics,
		api.reconcileRepoTopics,
	);

	sp.succeed(`Reconciled. Unique topics discovered: ${universe.size}`);

	// Phase 3 — refresh stale topic metadata
	sp = log
		.spinner(
			`Refreshing topic metadata (TTL=${TTL_DAYS}d, concurrency=${CONCURRENCY_META})...`,
		)
		.start();

	const refreshed = await refreshStaleTopicMeta(
		token,
		universe,
		TTL_DAYS,
		api.selectStaleTopics,
		api.topicMetaMany,
		api.upsertTopic,
		CONCURRENCY_META,
	);

	sp.succeed(`Refreshed metadata for ${refreshed} topics`);

	// Final summary
	log.success(
		`Topics enriched: repos=${rows.length}  unique_topics=${universe.size}  refreshed=${refreshed}`,
	);
}

// CLI entry (standalone usage)
if (import.meta.main) {
	const onlyActive = Bun.argv.includes("--active");
	const ttlIdx = Bun.argv.indexOf("--ttl");
	const ttl =
		ttlIdx > -1 && Bun.argv[ttlIdx + 1]
			? Number(Bun.argv[ttlIdx + 1])
			: undefined;

	log.header("Topics: enrich");
	log.info(
		`onlyActive=${onlyActive}  ttlDays=${ttl ?? Number(Bun.env.TOPIC_TTL_DAYS ?? 30)}`,
	);

	await enrichAllRepoTopics({ onlyActive, ttlDays: ttl }).catch((e) => {
		log.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	});
}
