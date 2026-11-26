import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb } from "@lib/db";
import { createDiscoveryService } from "./service";
import { createFetchConsumer } from "./consumer";

describe("connected evidence consumer", () => {
	it("fetches each target independently, records evidence, retries failures and cleans temporary files", async () => {
		const root = await mkdtemp(join(tmpdir(), "stars-consumer-fixture-"));
		const before = new Set(
			(await readdir(tmpdir())).filter((x) => x.startsWith("stars-research-")),
		);
		const db = createDb();
		try {
			const fetcher = join(root, "fake-fetch.py");
			await writeFile(
				fetcher,
				`import sys,json\nif 'retry' in sys.argv[1]:\n print('temporary',file=sys.stderr);sys.exit(1)\ndata=b'Independent source text'\nopen(sys.argv[2],'wb').write(data)\nprint(json.dumps({'url':sys.argv[1],'content_type':'text/plain','bytes':len(data)}))\n`,
			);
			const service = createDiscoveryService(db);
			await service.snapshot(
				{
					source: "list",
					revision: "v1",
					path: "README.md",
					baseUrl: "https://example.org/",
					topics: ["food"],
					markdown:
						"- [Food](https://example.org/food)\n- [Retry](https://example.org/retry)",
				},
				async () => null,
			);
			const outcomes = await service.research(createFetchConsumer({ fetcher }));
			expect(outcomes.map((o) => o.status).sort()).toEqual(["done", "retry"]);
			const row = db
				.query<{ result_json: string }, []>(
					"SELECT result_json FROM discovery_research",
				)
				.get();
			expect(JSON.parse(row?.result_json ?? "null")).toMatchObject({
				source_url: "https://example.org/food",
				text: "Independent source text",
				source_content_is_untrusted: true,
			});
			expect(service.work()).toHaveLength(1);
			const after = (await readdir(tmpdir())).filter(
				(x) => x.startsWith("stars-research-") && !before.has(x),
			);
			expect(after).toEqual([]);
		} finally {
			db.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});
