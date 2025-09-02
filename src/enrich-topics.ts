// src/jobs/enrich-topics.ts
import { createTopicsService } from "@features/topics/service";

// ---- Main job ---------------------------------------------------------------
export async function enrichAllRepoTopics(opts?: {
	onlyActive?: boolean;
	ttlDays?: number;
}): Promise<void> {
	const svc = createTopicsService();
	const res = await svc.enrichAllRepoTopics({
		onlyActive: opts?.onlyActive,
		ttlDays: opts?.ttlDays,
	});
	console.log(
		`Topics enriched: repos=${res.repos} unique_topics=${res.unique_topics} refreshed=${res.refreshed}`,
	);
}

// CLI entry
if (import.meta.main) {
	const onlyActive = Bun.argv.includes("--active");
	const ttlIdx = Bun.argv.indexOf("--ttl");
	const ttl =
		ttlIdx > -1 && Bun.argv[ttlIdx + 1]
			? Number(Bun.argv[ttlIdx + 1])
			: undefined;

	console.log(
		`Enrich topics: onlyActive=${onlyActive} ttlDays=${ttl ?? "(default)"}`,
	);
	await enrichAllRepoTopics({ onlyActive, ttlDays: ttl });
}
