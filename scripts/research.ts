import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

async function main() {
	const args = process.argv.slice(2);
	const value = (flag: string) => {
		const i = args.indexOf(flag);
		return i < 0 ? undefined : args[i + 1];
	};
	const dbPath = value("--db");
	const fetcher = value("--fetcher");
	if (!dbPath || !fetcher || !existsSync(dbPath) || !existsSync(fetcher))
		throw new Error(
			"Usage: bun run scripts/research.ts --db EXISTING_DB --fetcher SAFE_FETCH_PY",
		);
	Bun.env.DB_FILE = ":memory:";
	const { initSchema } = await import("../src/lib/db");
	const { createDiscoveryService } = await import(
		"../src/features/discovery/service"
	);
	const { createFetchConsumer } = await import(
		"../src/features/discovery/consumer"
	);
	const db = new Database(dbPath, { create: false });
	try {
		initSchema(db);
		const service = createDiscoveryService(db);
		const result = await service.research(createFetchConsumer({ fetcher }));
		const done = result.filter((item) => item.status === "done").length;
		console.log(
			JSON.stringify({
				processed: result.length,
				done,
				retry: result.length - done,
			}),
		);
		if (done !== result.length) process.exitCode = 1;
	} finally {
		db.close();
	}
}
if (import.meta.main)
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
