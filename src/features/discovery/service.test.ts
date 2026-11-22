import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@lib/db";
import { createIngestService } from "@features/ingest/service";
import { createDiscoveryService } from "./service";
import type { RepoInfo } from "@lib/types";

const repo: RepoInfo = {
	repoId: "node-1",
	nameWithOwner: "a/recipes",
	url: "https://github.com/a/recipes",
	stars: 1,
	forks: 0,
	watchers: 0,
	openIssues: 0,
	openPRs: 0,
	topics: [],
	languages: [],
	isArchived: false,
	isDisabled: false,
	isFork: false,
	isMirror: false,
	hasIssuesEnabled: true,
	pushedAt: "2020-01-01",
	updatedAt: "2020-01-01",
	createdAt: "2020-01-01",
};
const snapshot = (source: string, revision: string, markdown: string) => ({
	source,
	revision,
	markdown,
	path: "README.md",
	baseUrl: `https://example.org/${source}/`,
	topics: ["food"],
});

describe("discovery reconciliation", () => {
	it("repeats, keeps multiple sources and research independent of summaries and direct curation", async () => {
		const db = createDb();
		try {
			const ingest = createIngestService({ db });
			ingest.ingestFromData([], [repo], undefined, false);
			db.query(
				"UPDATE repo SET summary='existing research' WHERE repo_id=?",
			).run(repo.repoId);
			const service = createDiscoveryService(db);
			const body =
				"# Cookbooks\n| Repository | User | Website |\n| --- | --- | --- |\n| [Cook](https://github.com/a/recipes) | [Author](https://github.com/alice) | [Food](https://example.org/food) |";
			const resolve = async (url: string) =>
				url.includes("a/recipes") ? repo : null;
			await service.snapshot(snapshot("one", "r1", body), resolve);
			await service.snapshot(snapshot("one", "r1", body), resolve);
			await service.snapshot(snapshot("two", "r2", body), resolve);
			expect(service.work()).toHaveLength(2);
			expect(
				service.work().every((target) => target.sources.length === 2),
			).toBe(true);
			expect(service.work()[0].sources[0].observation.context_topics).toEqual([
				"food",
			]);
			expect(db.query("SELECT * FROM discovery_edge").all()).toHaveLength(4);
			expect(db.query("SELECT * FROM list_repo").all()).toHaveLength(0);
			let calls = 0;
			const first = await service.research(async () => {
				if (++calls === 1) throw new Error("temporary");
				return { fact: "ok" };
			});
			expect(first.map((x) => x.status).sort()).toEqual(["done", "retry"]);
			expect(service.work()).toHaveLength(1);
			await service.research(async () => ({ fact: "retry succeeded" }));
			service.removeSource("one");
			expect(db.query("SELECT * FROM discovery_edge").all()).toHaveLength(2);
			expect(service.work()).toHaveLength(2);
			await service.snapshot(snapshot("two", "r3", "# empty"), resolve);
			expect(db.query("SELECT * FROM discovery_edge").all()).toHaveLength(0);
			ingest.cleanupRemovedFromExports(new Set());
			expect(
				db
					.query<{ summary: string }, []>(
						"SELECT summary FROM repo WHERE repo_id='node-1'",
					)
					.get()?.summary,
			).toBe("existing research");
		} finally {
			db.close();
		}
	});
	it("retains stable relationships through resolution failures and keeps file targets separate", async () => {
		const db = createDb();
		try {
			const ingest = createIngestService({ db });
			ingest.ingestFromData(
				[{ listId: "list", name: "Direct", isPrivate: false, repos: [repo] }],
				[],
				undefined,
				false,
			);
			const service = createDiscoveryService(db);
			const body =
				"- [Repository](https://github.com/a/recipes)\n- [Recipe](https://github.com/a/recipes/blob/main/pie.cook)";
			await service.snapshot(snapshot("one", "r1", body), async () => repo);
			expect(service.work()).toHaveLength(2);
			expect(db.query("SELECT * FROM repo").all()).toHaveLength(1);
			expect(db.query("SELECT * FROM list_repo").all()).toHaveLength(1);
			await service.research(async () => ({ research: 1 }));
			await service.snapshot(snapshot("one", "r2", body), async () => {
				throw new Error("unavailable");
			});
			expect(
				db
					.query<{ target_key: string }, []>(
						"SELECT target_key FROM discovery_edge ORDER BY target_key",
					)
					.all()
					.every((x) => x.target_key.startsWith("github:node-1")),
			).toBe(true);
			expect(service.work()).toHaveLength(0);
			await service.snapshot(snapshot("one", "r2", body), async () => repo);
			expect(service.work()).toHaveLength(2);
			await service.research(async () => ({ research: 2 }));
			expect(db.query("SELECT * FROM discovery_research").all()).toHaveLength(
				4,
			);
			ingest.cleanupRemovedFromExports(new Set());
			expect(db.query("SELECT * FROM list_repo").all()).toHaveLength(0);
			expect(db.query("SELECT * FROM repo").all()).toHaveLength(1);
		} finally {
			db.close();
		}
	});
	it("protects renamed discoveries during a complete file export while removing unrelated repos", async () => {
		const db = createDb();
		const dir = mkdtempSync(join(tmpdir(), "stars-discovery-export-"));
		try {
			const ingest = createIngestService({ db });
			ingest.ingestFromData(
				[],
				[
					repo,
					{
						...repo,
						repoId: "unrelated",
						nameWithOwner: "z/removed",
						url: "https://github.com/z/removed",
					},
				],
				undefined,
				false,
			);
			db.query("UPDATE repo SET summary='keep' WHERE repo_id='node-1'").run();
			const service = createDiscoveryService(db);
			const body = "- [cookbook](https://github.com/a/recipes)";
			await service.snapshot(snapshot("one", "r1", body), async () => repo);
			const renamed = {
				...repo,
				nameWithOwner: "a/renamed",
				url: "https://github.com/a/renamed",
			};
			await service.snapshot(snapshot("one", "r2", body), async () => renamed);
			writeFileSync(join(dir, "index.json"), "[]");
			writeFileSync(join(dir, "unlisted.json"), "[]");
			await ingest.ingestFromExports(dir);
			expect(
				db
					.query<{ name_with_owner: string; summary: string }, []>(
						"SELECT name_with_owner,summary FROM repo",
					)
					.all(),
			).toEqual([{ name_with_owner: "a/renamed", summary: "keep" }]);
		} finally {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("keeps existing override protection for discovered repositories", async () => {
		const db = createDb();
		try {
			const ingest = createIngestService({ db });
			ingest.ingestFromData(
				[{ listId: "list", name: "Direct", isPrivate: false, repos: [repo] }],
				[],
				undefined,
				false,
			);
			db.query(
				"INSERT INTO repo_overrides(repo_id,summary_override,updated_at) SELECT id,'manual','2024-01-01' FROM repo WHERE repo_id='node-1'",
			).run();
			await createDiscoveryService(db).snapshot(
				snapshot("one", "r1", "- [repo](https://github.com/a/recipes)"),
				async () => repo,
			);
			ingest.cleanupRemovedFromExports(new Set());
			expect(db.query("SELECT * FROM list_repo").all()).toHaveLength(1);
		} finally {
			db.close();
		}
	});
	it("keeps changed source context pending when an in-flight research fetch finishes", async () => {
		const db = createDb();
		try {
			const service = createDiscoveryService(db);
			const body = "- [Site](https://example.org/food)";
			await service.snapshot(snapshot("one", "r1", body), async () => null);
			let release!: () => void;
			let started!: () => void;
			const waiting = new Promise<void>((resolve) => {
				release = resolve;
			});
			const running = new Promise<void>((resolve) => {
				started = resolve;
			});
			const task = service.research(async () => {
				started();
				await waiting;
				return { observation: "old" };
			});
			await running;
			await service.snapshot(snapshot("one", "r2", body), async () => null);
			release();
			expect(await task).toEqual([
				{ key: "url:https://example.org/food", status: "changed" },
			]);
			expect(service.work()).toHaveLength(1);
			const row = db
				.query<{ source_context_json: string }, []>(
					"SELECT source_context_json FROM discovery_research",
				)
				.get();
			expect(
				JSON.parse(row?.source_context_json ?? "[]")[0].observation.revision,
			).toBe("r1");
			expect(service.work()[0].sources[0].observation.revision).toBe("r2");
		} finally {
			db.close();
		}
	});
	it("upgrades earlier research history without deleting saved results", async () => {
		const db = createDb();
		try {
			db.exec(`CREATE TABLE discovery_target (key TEXT PRIMARY KEY,url TEXT NOT NULL,repo_node_id TEXT,status TEXT NOT NULL DEFAULT 'pending',error TEXT,result_json TEXT);
    CREATE TABLE discovery_research (id INTEGER PRIMARY KEY,target_key TEXT NOT NULL REFERENCES discovery_target(key),completed_at TEXT NOT NULL DEFAULT 'old',result_json TEXT NOT NULL);
    INSERT INTO discovery_target(key,url,status) VALUES ('url:https://example.org/old','https://example.org/old','done');
    INSERT INTO discovery_research(target_key,result_json) VALUES ('url:https://example.org/old','{"old":true}');`);
			createDiscoveryService(db);
			const saved = db
				.query<{ result_json: string; source_context_json: string }, []>(
					"SELECT result_json,source_context_json FROM discovery_research",
				)
				.get();
			expect(saved).toEqual({
				result_json: '{"old":true}',
				source_context_json: "[]",
			});
		} finally {
			db.close();
		}
	});
});
