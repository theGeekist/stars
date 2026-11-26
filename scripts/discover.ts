import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { CuratedSource } from "../src/features/discovery/backfill";

async function main() {
	const args = process.argv.slice(2);
	const value = (flag: string) => {
		const i = args.indexOf(flag);
		return i < 0 ? undefined : args[i + 1];
	};
	const dbPath = value("--db");
	const exportDir = value("--exports");
	if (!dbPath || !exportDir || !existsSync(dbPath))
		throw new Error(
			"Usage: bun run scripts/discover.ts --db EXISTING_DB --exports COMPLETE_EXPORT_DIR",
		);
	const base = resolve(exportDir);
	const read = (file: string): unknown => {
		const path = resolve(base, file);
		if (!path.startsWith(base + sep))
			throw new Error("Export path escapes directory");
		return JSON.parse(readFileSync(path, "utf8"));
	};
	const index = read("index.json");
	const unlisted = read("unlisted.json");
	if (!Array.isArray(index) || !Array.isArray(unlisted))
		throw new Error("Complete index and unlisted arrays required");
	const repos: unknown[] = [...unlisted];
	for (const entry of index) {
		if (!entry || typeof entry.file !== "string")
			throw new Error("Invalid index entry");
		const list = read(entry.file) as { repos?: unknown };
		if (!Array.isArray(list.repos))
			throw new Error(`Invalid list ${entry.file}`);
		repos.push(...list.repos);
	}
	const sources = new Map<string, CuratedSource>();
	for (const value of repos) {
		const repo = value as Partial<CuratedSource>;
		if (
			!repo ||
			typeof repo.repoId !== "string" ||
			!repo.repoId ||
			typeof repo.nameWithOwner !== "string"
		)
			throw new Error(
				"Every curated source needs a stable repoId and nameWithOwner",
			);
		sources.set(repo.repoId, {
			repoId: repo.repoId,
			nameWithOwner: repo.nameWithOwner,
			topics: Array.isArray(repo.topics) ? repo.topics : [],
		});
	}
	// The shared DB module opens a default singleton on import. Keep it in memory.
	Bun.env.DB_FILE = ":memory:";
	const { initSchema } = await import("../src/lib/db");
	const { backfillCollections } = await import(
		"../src/features/discovery/backfill"
	);
	const { githubDiscovery } = await import("../src/features/discovery/github");
	const adapter = githubDiscovery(
		Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN ?? "",
	);
	const db = new Database(dbPath, { create: false });
	try {
		initSchema(db);
		const result = await backfillCollections(
			db,
			[...sources.values()],
			adapter,
			(completed, total) =>
				console.error(`Discovery sources processed: ${completed}/${total}`),
		);
		console.log(JSON.stringify(result, null, 2));
		if (result.failures.length) process.exitCode = 1;
	} finally {
		db.close();
	}
}
if (import.meta.main)
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
