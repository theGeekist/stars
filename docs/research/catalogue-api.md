# Stars catalogue and operation API

The catalogue query surface reuses the existing SQLite catalogue and HTTP
handlers in `src/api/research.ts`. Its GET routes read saved Stars data and do
not fetch GitHub or backfill collections.

## Research HTTP contract

- `GET /research/overview` reports catalogue counts, summary/README/tag/topic
  coverage, score-run coverage and discovery-table availability.
- `GET /research/repositories` accepts full-text search and structured list,
  topic, language, stars, score and metadata filters, with `limit`, `offset`
  and deterministic sorting.
- `GET /research/repository?key=...` or
  `GET /research/repository/:owner/:repo` returns a profile, memberships,
  topics, score history, curated overrides and discovery data.
- `GET /research/topics` lists topics or resolves a topic/alias with related
  topics and repositories.
- `GET /research/discoveries` pages discovered targets, source observations
  and retained research.

These GET routes return JSON without independent authentication. They are safe
for MCP use only behind the loopback Stars server and authenticated Hub.

Pagination and booleans are validated; invalid values return 400 instead of
being coerced. Repository/topic pages accept at most 100 rows, discovery pages
at most 25, and score-history pages at most 100. Use `offset` to page through
larger results. Opt-in source-context bodies include
`sourceContextTruncated`, `sourceContextOmitted` and `sourceContextBytes` so
clients can distinguish complete, truncated and omitted evidence. Regression
tests cover latest applicable scores, one-read-snapshot consistency, malformed
FTS input, provenance-only repositories, subpath identity matching, bounded
nested evidence, validated pagination and stable ordering.

## Typed operation routes

`POST /operations?name=...` accepts only the names in
`src/research-operations.ts` and validates each operation's bounded fields. It
returns a job id. `GET /operations/jobs` and `GET /operations/jobs/:id` report
job state and bounded results; `POST /operations/jobs/:id/cancel` terminates a
worker process. Mutating catalogue/configuration operations use the existing
Stars run lock with a 24-hour wait; lock ownership produces a queued job rather
than an immediate failure. Cancellation is not a rollback: local commits and
GitHub List changes already completed remain.

The allowlist covers the public list/star fetch and ingestion operations,
single and batch summarisation/scoring, topic enrichment, and fixed prompt/model
setup operations. Summary and score calls default to dry-run. Applying scores
can persist score history and update GitHub List membership under the configured
curation policy. No operation accepts a database path, arbitrary command, SQL,
or credential. The HTTP server remains loopback-only; the existing
owner-authenticated MCP path forwards typed tools to it.
