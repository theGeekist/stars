import type { Database } from "bun:sqlite";
import type { RepoInfo } from "@lib/types";
import { createIngestService } from "@features/ingest/service";
import { createProvenanceService } from "@features/ingest/provenance";
import { extractMarkdownMentions } from "./parser";

export type CollectionSnapshot = {
	source: string;
	revision: string;
	path: string;
	markdown: string;
	baseUrl: string;
	topics: string[];
};
export type ResearchTarget = {
	key: string;
	url: string;
	status: string;
	error: string | null;
	sources: Array<{ source: string; observation: Record<string, unknown> }>;
};

/** State is separate from source observations and repository summaries. */
export function createDiscoveryService(db: Database) {
	db.exec(`CREATE TABLE IF NOT EXISTS discovery_target (
    key TEXT PRIMARY KEY, url TEXT NOT NULL, repo_node_id TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT, result_json TEXT
  );
  CREATE TABLE IF NOT EXISTS discovery_research (
    id INTEGER PRIMARY KEY, target_key TEXT NOT NULL REFERENCES discovery_target(key),
    completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), result_json TEXT NOT NULL,
    source_context_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS discovery_edge (
    source TEXT NOT NULL, target_key TEXT NOT NULL REFERENCES discovery_target(key),
    observation_json TEXT NOT NULL, PRIMARY KEY(source, target_key, observation_json)
  );`);
	const researchColumns = db
		.query<{ name: string }, []>("PRAGMA table_info(discovery_research)")
		.all();
	if (!researchColumns.some((column) => column.name === "source_context_json"))
		db.exec(
			"ALTER TABLE discovery_research ADD COLUMN source_context_json TEXT NOT NULL DEFAULT '[]'",
		);
	const provenance = createProvenanceService({ db });
	const ingest = createIngestService({ db });
	function sourceContext(key: string): ResearchTarget["sources"] {
		return db
			.query<{ source: string; observation_json: string }, [string]>(
				"SELECT source,observation_json FROM discovery_edge WHERE target_key=? ORDER BY source,observation_json",
			)
			.all(key)
			.map((edge) => ({
				source: edge.source,
				observation: JSON.parse(edge.observation_json) as Record<
					string,
					unknown
				>,
			}));
	}
	function sameContext(target: ResearchTarget): boolean {
		return (
			JSON.stringify(sourceContext(target.key)) ===
			JSON.stringify(target.sources)
		);
	}
	function requeueIfSourced(key: string) {
		db.query(
			"UPDATE discovery_target SET status='pending', error=NULL WHERE key=? AND status != 'resolve_retry' AND EXISTS (SELECT 1 FROM discovery_edge WHERE target_key=?)",
		).run(key, key);
	}
	return {
		/** Replace current source edges only after a complete snapshot has been parsed and recorded. */
		async snapshot(
			snapshot: CollectionSnapshot,
			resolve: (url: string) => Promise<RepoInfo | null>,
		) {
			const mentions = extractMarkdownMentions(
				snapshot.markdown,
				snapshot.baseUrl,
			).filter((m) => m.role !== "author");
			const previousEdges = db
				.query<{ target_key: string; observation_json: string }, [string]>(
					"SELECT target_key,observation_json FROM discovery_edge WHERE source=?",
				)
				.all(snapshot.source);
			const results: Array<{
				observation: Record<string, unknown> & { target: string };
				key: string;
				repo: RepoInfo | null;
				error: string | null;
			}> = [];
			for (const mention of mentions) {
				let repo: RepoInfo | null = null;
				let error: string | null = null;
				try {
					repo = await resolve(mention.url);
					if (repo && !repo.repoId)
						throw new Error("Resolved repository lacks GitHub identity");
					if (repo) {
						const byName = db
							.query<{ id: number; repo_id: string | null }, [string]>(
								"SELECT id,repo_id FROM repo WHERE lower(name_with_owner)=lower(?)",
							)
							.get(repo.nameWithOwner);
						const byId = db
							.query<{ id: number }, [string]>(
								"SELECT id FROM repo WHERE repo_id=?",
							)
							.get(repo.repoId);
						if (
							(byName?.repo_id && byName.repo_id !== repo.repoId) ||
							(byName && byId && byName.id !== byId.id)
						)
							throw new Error("Repository identity collision requires review");
					}
				} catch (e) {
					repo = null;
					error = e instanceof Error ? e.message : String(e);
				}
				const old = error
					? previousEdges.find(
							(edge) =>
								JSON.parse(edge.observation_json).target === mention.url,
						)
					: undefined;
				const parts = new URL(mention.url).pathname.split("/").filter(Boolean);
				const resource =
					repo?.repoId && parts.length > 2
						? `:resource:${parts.slice(2).join("/")}`
						: "";
				const key = repo?.repoId
					? `github:${repo.repoId}${resource}`
					: (old?.target_key ?? `url:${mention.url}`);
				results.push({
					key,
					repo,
					error,
					observation: {
						target: mention.url,
						revision: snapshot.revision,
						path: snapshot.path,
						line: mention.line,
						section: mention.section,
						column: mention.column ?? null,
						context: mention.context,
						label: mention.label,
						related_links: mention.related_links ?? [],
						context_topics: snapshot.topics,
						target_key: key,
					},
				});
			}
			db.transaction(() => {
				const previous = new Set(
					db
						.query<{ observation_json: string }, [string]>(
							"SELECT observation_json FROM discovery_edge WHERE source=?",
						)
						.all(snapshot.source)
						.map((row) => row.observation_json),
				);
				db.query("DELETE FROM discovery_edge WHERE source = ?").run(
					snapshot.source,
				);
				const ingested = new Set<string>();
				for (const item of results) {
					if (item.repo && !ingested.has(item.repo.repoId)) {
						ingest.ingestFromData([], [item.repo], undefined, false);
						ingested.add(item.repo.repoId);
					}
					db.query(`INSERT INTO discovery_target(key,url,repo_node_id,status,error) VALUES (?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET url=excluded.url, error=CASE WHEN excluded.error IS NOT NULL THEN excluded.error ELSE discovery_target.error END,
            status=CASE WHEN excluded.error IS NOT NULL THEN 'resolve_retry' ELSE discovery_target.status END`).run(
						item.key,
						item.observation.target,
						item.repo?.repoId ?? null,
						item.error ? "resolve_retry" : "pending",
						item.error,
					);
					db.query(
						"INSERT OR IGNORE INTO discovery_edge(source,target_key,observation_json) VALUES (?,?,?)",
					).run(snapshot.source, item.key, JSON.stringify(item.observation));
					if (
						(!previous.has(JSON.stringify(item.observation)) ||
							db
								.query<{ status: string }, [string]>(
									"SELECT status FROM discovery_target WHERE key=?",
								)
								.get(item.key)?.status === "resolve_retry") &&
						!item.error
					)
						db.query(
							"UPDATE discovery_target SET status='pending', error=NULL WHERE key=?",
						).run(item.key);
					provenance.record(snapshot.source, item.observation);
				}
				const currentKeys = new Set(results.map((item) => item.key));
				for (const key of new Set(
					previousEdges.map((edge) => edge.target_key),
				)) {
					if (!currentKeys.has(key)) requeueIfSourced(key);
				}
			})();
			return {
				mentions: results.length,
				failed: results.filter((r) => r.error).length,
			};
		},
		removeSource(source: string) {
			db.transaction(() => {
				const keys = db
					.query<{ target_key: string }, [string]>(
						"SELECT DISTINCT target_key FROM discovery_edge WHERE source=?",
					)
					.all(source);
				db.query("DELETE FROM discovery_edge WHERE source = ?").run(source);
				for (const { target_key } of keys) requeueIfSourced(target_key);
			})();
		},
		work(): ResearchTarget[] {
			const rows = db
				.query<Omit<ResearchTarget, "sources">, []>(
					`SELECT key,url,status,error FROM discovery_target WHERE status IN ('pending','retry') AND EXISTS (SELECT 1 FROM discovery_edge WHERE target_key=discovery_target.key) ORDER BY key`,
				)
				.all();
			return rows.map((row) => ({ ...row, sources: sourceContext(row.key) }));
		},
		async research(consumer: (target: ResearchTarget) => Promise<unknown>) {
			const outcomes: Array<{ key: string; status: string }> = [];
			for (const target of this.work()) {
				try {
					const result = await consumer(target);
					const resultJson = JSON.stringify(result ?? null);
					const current = db.transaction(() => {
						db.query(
							"INSERT INTO discovery_research(target_key,result_json,source_context_json) VALUES (?,?,?)",
						).run(target.key, resultJson, JSON.stringify(target.sources));
						if (!sameContext(target)) return false;
						return (
							db
								.query(
									"UPDATE discovery_target SET status='done', error=NULL, result_json=? WHERE key=? AND status IN ('pending','retry')",
								)
								.run(resultJson, target.key).changes > 0
						);
					})();
					outcomes.push({
						key: target.key,
						status: current ? "done" : "changed",
					});
				} catch (e) {
					const current = db.transaction(() => {
						if (!sameContext(target)) return false;
						return (
							db
								.query(
									"UPDATE discovery_target SET status='retry', error=? WHERE key=? AND status IN ('pending','retry')",
								)
								.run(e instanceof Error ? e.message : String(e), target.key)
								.changes > 0
						);
					})();
					outcomes.push({
						key: target.key,
						status: current ? "retry" : "changed",
					});
				}
			}
			return outcomes;
		},
	};
}
