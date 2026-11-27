import { describe, expect, it } from "bun:test";
import { createDb } from "@lib/db";
import { handleResearchApi } from "./research";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected JSON object");
	return value as JsonObject;
}

function list(value: unknown): JsonObject[] {
	if (!Array.isArray(value)) throw new Error("Expected JSON array");
	return value.map(object);
}

function get(db: ReturnType<typeof createDb>, path: string) {
	const response = handleResearchApi(new URL(`http://localhost${path}`), db);
	if (!response) throw new Error(`No research handler for ${path}`);
	return response;
}

function body(response: Response) {
	return response.json() as Promise<JsonObject>;
}

describe("research API", () => {
	it("keeps each repository's latest applicable score through partial later runs", async () => {
		const db = createDb();
		db.query(
			"INSERT INTO repo(id,repo_id,name_with_owner,url,description) VALUES (1,'node-1','acme/one','https://github.com/acme/one','')",
		).run();
		db.query(
			"INSERT INTO repo(id,repo_id,name_with_owner,url,description) VALUES (2,'node-2','acme/two','https://github.com/acme/two','')",
		).run();
		db.query(
			"INSERT INTO model_run(id,notes) VALUES (1,'complete'),(2,'partial')",
		).run();
		db.query(
			"INSERT INTO repo_list_score(run_id,repo_id,list_slug,score) VALUES (1,1,'wordpress',0.8),(2,2,'wordpress',0.2)",
		).run();

		const result = await body(get(db, "/research/repositories?minScore=0.7"));
		expect(object(result.page).total).toBe(1);
		const repository = list(result.repositories)[0];
		expect(repository.name_with_owner).toBe("acme/one");
		expect(repository.latestScores).toMatchObject([
			{ run_id: 1, score: 0.8, list_slug: "wordpress" },
		]);
		db.close();
	});

	it("falls back to LIKE for malformed FTS and rejects invalid pagination", async () => {
		const db = createDb();
		db.query(
			"INSERT INTO repo(id,name_with_owner,url,description) VALUES (1,'acme/one','https://github.com/acme/one','search fallback phrase')",
		).run();
		const malformed = await get(db, "/research/repositories?q=%22unclosed");
		expect(malformed.status).toBe(200);
		expect(list((await body(malformed)).repositories)).toHaveLength(0);
		expect(get(db, "/research/repositories?limit=0").status).toBe(400);
		expect(get(db, "/research/repositories?offset=-1").status).toBe(400);
		db.close();
	});

	it("returns provenance without discovery targets and matches repository subpaths", async () => {
		const db = createDb();
		db.query(
			"INSERT INTO repo(id,repo_id,name_with_owner,url) VALUES (1,'node-1','acme/one','https://github.com/acme/one')",
		).run();
		db.query(
			"INSERT INTO recovery_provenance(source,details_json) VALUES (?,?)",
		).run(
			"awesome-list",
			JSON.stringify({
				discovery_observations: [
					{
						target: "https://github.com/acme/one/tree/main/docs",
						revision: "abc123",
					},
				],
			}),
		);
		const result = await body(get(db, "/research/repository?key=acme%2Fone"));
		const discovery = object(result.discovery);
		expect(discovery.available).toBe(true);
		expect(discovery.targetsAvailable).toBe(false);
		expect(list(discovery.provenance)[0].source).toBe("awesome-list");
		db.close();
	});

	it("includes discovery targets keyed to a repository and its file subpaths", async () => {
		const db = createDb();
		db.query(
			"INSERT INTO repo(id,repo_id,name_with_owner,url) VALUES (1,'node-1','acme/one','https://github.com/acme/one')",
		).run();
		db.query(
			"CREATE TABLE discovery_target(key TEXT PRIMARY KEY,url TEXT NOT NULL,repo_node_id TEXT,status TEXT NOT NULL,error TEXT,result_json TEXT)",
		).run();
		db.query(
			"CREATE TABLE discovery_edge(source TEXT NOT NULL,target_key TEXT NOT NULL,observation_json TEXT NOT NULL)",
		).run();
		db.query("INSERT INTO discovery_target VALUES (?,?,?,?,?,?)").run(
			"github:node-1:resource:docs/readme.md",
			"https://github.com/acme/one/blob/main/docs/readme.md",
			"node-1",
			"done",
			null,
			"{}",
		);
		db.query("INSERT INTO discovery_edge VALUES (?,?,?)").run(
			"awesome-list",
			"github:node-1:resource:docs/readme.md",
			JSON.stringify({
				target: "https://github.com/acme/one/blob/main/docs/readme.md",
				revision: "abc123",
			}),
		);
		const result = await body(get(db, "/research/repository?key=acme%2Fone"));
		const targets = list(object(result.discovery).targets);
		expect(targets).toHaveLength(1);
		expect(targets[0].key).toBe("github:node-1:resource:docs/readme.md");
		expect(list(targets[0].edges)[0]).toMatchObject({
			source: "awesome-list",
			revision: "abc123",
		});
		db.close();
	});

	it("omits duplicate raw evidence by default and caps opt-in nested bodies", async () => {
		const db = createDb();
		db.query(
			"CREATE TABLE discovery_target(key TEXT PRIMARY KEY,url TEXT NOT NULL,repo_node_id TEXT,status TEXT NOT NULL,error TEXT,result_json TEXT)",
		).run();
		db.query(
			"CREATE TABLE discovery_research(id INTEGER PRIMARY KEY,target_key TEXT NOT NULL,completed_at TEXT NOT NULL,result_json TEXT NOT NULL,source_context_json TEXT NOT NULL DEFAULT '[]')",
		).run();
		db.query(
			"CREATE TABLE discovery_edge(source TEXT NOT NULL,target_key TEXT NOT NULL,observation_json TEXT NOT NULL)",
		).run();
		db.query("INSERT INTO discovery_target VALUES (?,?,?,?,?,?)").run(
			"github:node-1:resource:docs/readme.md",
			"https://github.com/acme/one/blob/main/docs/readme.md",
			"node-1",
			"done",
			null,
			JSON.stringify({ evidence: "x".repeat(40_000) }),
		);
		db.query(
			"INSERT INTO discovery_research(target_key,completed_at,result_json,source_context_json) VALUES (?,?,?,?)",
		).run(
			"github:node-1:resource:docs/readme.md",
			"2026-01-01",
			JSON.stringify({ evidence: "y".repeat(40_000) }),
			"[]",
		);
		const metadata = await body(get(db, "/research/discoveries?limit=1"));
		const metadataDiscovery = list(metadata.discoveries)[0];
		expect(metadataDiscovery.result_json).toBeUndefined();
		expect(metadataDiscovery.result).toBeUndefined();
		expect(metadataDiscovery.bodyAvailable).toBe(true);
		const evidence = await body(
			get(db, "/research/discoveries?limit=1&includeEvidence=true"),
		);
		expect(list(evidence.discoveries)[0].bodyTruncated).toBe(true);
		expect(JSON.stringify(evidence).length).toBeLessThan(30_000);
		db.close();
	});

	it("sorts equal-name repositories deterministically", async () => {
		const db = createDb();
		db.query(
			"INSERT INTO repo(id,name_with_owner,url) VALUES (2,'acme/two','https://github.com/acme/two'),(1,'acme/one','https://github.com/acme/one')",
		).run();
		const result = await body(get(db, "/research/repositories?sort=name"));
		expect(
			list(result.repositories).map((item) => item.name_with_owner),
		).toEqual(["acme/one", "acme/two"]);
		db.close();
	});
});
