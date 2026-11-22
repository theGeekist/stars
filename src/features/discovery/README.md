# Collection discovery

Discovery reads a **complete, current** Stars export and inspects the README of every directly exported repository. It parses Markdown list items and GFM tables; it does not infer that every link is a verified collection entry. Table author columns are context, not targets. Links in ambiguous columns are retained as unverified research targets; row context preserves author links and their roles. It does not create GitHub List membership. GitHub repository links are resolved to node IDs and ingested through the existing service. Subdirectories and files remain separate research targets; external URLs have URL identities. No age or activity filter is applied.

The command verifies each collection’s GitHub node ID before reading its README and makes GitHub API requests for each exported repository and each GitHub target. It may take substantial time and consume API quota. Repositories without an accessible README are reported as failures; their prior observations remain current until a successful read. Inspect exit status and the JSON failure report; rerun the same command to retry. The command does not fetch external target pages, run an LLM, change stars or lists, publish, or schedule itself.

```sh
# From the Stars checkout; use a verified, complete current export and the intended existing DB.
GITHUB_TOKEN="$(gh auth token)" bun run scripts/discover.ts \
  --db /absolute/path/to/repolists.db \
  --exports /absolute/path/to/exports
```

Both `index.json` (and every file it names) and `unlisted.json` must be present and contain the whole current curation snapshot. A merely present export may be stale or incomplete: it is the caller's responsibility to validate freshness and completeness. A complete export that omits a previously processed source removes its current discovery edges; a failed source fetch does not. Historical observations remain in `recovery_provenance`. A target with no current source remains in the database with its research history, but is not selected for new work. Export cleanup retains any repository ever discovered, even after its last source disappears, while removing absent direct List memberships unless an existing repository override protects them. Ordinary never-discovered, non-overridden repositories retain normal cleanup behavior.

Use an isolated database and fixtures to trial a backfill. The command requires an existing DB path and explicitly keeps the shared default DB singleton in memory. It closes the selected database on success and failure. It does not create temporary files itself.

## Fetch independent source evidence

Discovery and evidence fetching are separate steps. Run the existing Geekist bounded HTTPS fetcher as a consumer of pending work:

```sh
bun run scripts/research.ts \
  --db /absolute/path/to/repolists.db \
  --fetcher /absolute/path/to/geekist-admin/scripts/stars/safe-fetch.py
```

The fetcher is supplied as a path, so Stars is not tied to one checkout. It validates public addresses and redirects, limits response size and writes a temporary file. The consumer records the requested and final URLs, retrieval time, content type, byte count, SHA-256 and textual response when applicable. It marks fetched material as untrusted source evidence, not a verified claim or a completed editorial report. It removes temporary files on success and failure; item failures stay retryable. HTTP-only, inaccessible or oversized sources can fail and remain in the queue. A repeated consumer run skips completed targets until a source relationship changes; it can make network requests for retryable or requeued targets.

Use an isolated database and a fixture fetcher to trial it. The command requires an existing DB path, keeps the shared default DB singleton in memory, and closes the selected database. `work()` and `research()` also support another consumer through the public API. Set `DB_FILE=:memory:` before importing it if providing an explicit database, because the shared DB module otherwise opens its default singleton at import time. Each work item includes its current source observations.

```ts
import { Database } from "bun:sqlite";
import { discovery } from "@geekist/stars";
const db = new Database("/absolute/path/to/repolists.db");
try {
  const service = discovery.createDiscoveryService(db);
  console.log(service.work());
  await service.research(
    discovery.createFetchConsumer({
      fetcher: "/absolute/path/to/safe-fetch.py",
    }),
  );
} finally {
  db.close();
}
```

A changed source observation requeues its target. Each research result records the exact source context used. If that context changes during a fetch, its result is retained as history and the current work remains pending. Results created before source-context tracking have an empty recorded context. Resolution failures are retried by backfilling; failed consumer items can be retried by rerunning the consumer. A target with no current source is retained but excluded from work selection.

Current parsing covers Markdown lists and GFM tables in the selected README only. It does not enumerate recipe archives, parse Cooklang files, verify claims, identify all possible author/link roles, or turn a source subpath into a fetched child resource. URL and repository identity resolution can fail due to permissions, renames, network errors or rate limits. Inspect those failures and research results before using them.
