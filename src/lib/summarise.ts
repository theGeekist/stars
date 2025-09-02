// Thin wrapper to support package.json script "sum:one" using the unified CLI helpers
import { summariseOne } from "@src/cli-summarise";
import { createLogger } from "@lib/logger";
import { initSchema } from "@lib/db";

initSchema();

if (import.meta.main) {
	const log = createLogger();
	const idx = Bun.argv.indexOf("--one");
	const apply = Bun.argv.includes("--apply");
	if (idx === -1 || !Bun.argv[idx + 1]) {
		log.error(
			"Usage: bun run src/lib/summarise.ts --one <owner/repo> [--apply]",
		);
		process.exit(1);
	}
	const selector = Bun.argv[idx + 1];
	await summariseOne(selector, apply);
}
