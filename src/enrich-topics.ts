// src/enrich-topics.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
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
 * Fully synchronous; DB-only (no network).
 */
export function enrichAllRepoTopics(opts?: {
	onlyActive?: boolean;
	ttlDays?: number;
}): void {
	const ONLY_ACTIVE = !!opts?.onlyActive;
	const TTL_DAYS = opts?.ttlDays ?? Number(Bun.env.TOPIC_TTL_DAYS ?? 30);
	const CONCURRENCY_REPOS = Number(Bun.env.TOPIC_REPO_CONCURRENCY ?? 4);

	// Phase 0 — repo selection
	const rows = listRepoRefsFromDb(ONLY_ACTIVE);
	if (!rows.length) {
		log.info("No repositories found to enrich (check your DB).");
		return;
	}

	log.header("Topics enrichment");
	log.info(
		`Repos: ${rows.length}  •  Active only: ${
			ONLY_ACTIVE ? "yes" : "no"
		}  •  TTL: ${TTL_DAYS}d`,
	);

	// Phase 1 — read topics from our own DB (repo.topics JSON)
	let sp = log
		.spinner(
			`Fetching topics for ${rows.length} repos (concurrency=${CONCURRENCY_REPOS})...`,
		)
		.start();

	const refs = buildRepoRefs(rows);
	// DB-only: repoTopicsMany ignores token and is sync
	const topicsByRepo = api.repoTopicsMany(refs, {
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

	// Phase 3 — refresh topic metadata from local github/explore clone (if available)
	const exploreBase = Bun.env.GH_EXPLORE_PATH;
	const exploreOk =
		!!exploreBase &&
		existsSync(exploreBase) &&
		existsSync(join(exploreBase, "topics"));

	let refreshed = 0;

	if (!exploreOk) {
		log.warn(
			"GH_EXPLORE_PATH not set or invalid; skipping topic metadata refresh. " +
				"Set GH_EXPLORE_PATH to your local clone of github/explore.",
		);
	} else {
		sp = log.spinner(`Refreshing topic metadata (TTL=${TTL_DAYS}d)...`).start();

		// DB-only: refreshStaleTopicMeta + topicMetaMany are sync
		refreshed = refreshStaleTopicMeta(
			universe,
			TTL_DAYS,
			api.selectStaleTopics,
			api.topicMetaMany,
			api.upsertTopic,
			/* _topicConcurrency ignored in DB-only path */ 0,
		);

		sp.succeed(`Refreshed metadata for ${refreshed} topics`);
	}

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
		`onlyActive=${onlyActive}  ttlDays=${
			ttl ?? Number(Bun.env.TOPIC_TTL_DAYS ?? 30)
		}`,
	);

	try {
		enrichAllRepoTopics({ onlyActive, ttlDays: ttl });
	} catch (e) {
		log.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	}
}
