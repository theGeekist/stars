# Stars catalogue research API

This read-only surface reuses the existing SQLite catalogue and HTTP handlers
in `src/api/research.ts`; it does not fetch GitHub or backfill collections.

## HTTP contract

- `GET /research/overview` reports catalogue counts, summary/README/tag/topic
  coverage, score-run coverage and discovery-table availability.
- `GET /research/repositories` accepts a full-text query and structured list,
  topic, language, stars, score and metadata filters, with `limit`, `offset`
  and deterministic sorting.
- `GET /research/repository?key=...` or
  `GET /research/repository/:owner/:repo` returns a repository profile,
  memberships, topics, score history, curated overrides and discovery data.
- `GET /research/topics` lists topics or resolves a canonical topic/alias with
  related topics and repositories.
- `GET /research/discoveries` pages discovered targets, source observations
  and retained research.

All routes return JSON and have no independent authentication. They are safe
for MCP use only behind the loopback-only Stars HTTP server and the
authenticated MCP Hub. The MCP adapter calls only these fixed research routes
over loopback and does not expose general HTTP routes.

## MCP read tools

The initial tool set is `stars_overview`, `stars_search_repositories`,
`stars_repository_profile`, `stars_explore_topics`, and
`stars_search_discoveries`. The existing Fedora MCP SDK validates typed tool
inputs; result pages and total output are capped. Profiles return score history
and evidence metadata with source references; README and evidence bodies
require an explicit bounded request. Missing optional discovery tables are
reported as unavailable instead of being represented as an empty complete
catalogue.

The HTTP paths and JSON response structures remain in place, with stricter
input validation. Numeric pagination and booleans must be valid values; invalid
values now return 400 instead of being coerced or clamped. Topic and repository
search pages accept at most 100 rows; discovery pages accept at most 25, and
score-history pages at most 100. Keep `limit` at or below the route maximum and
use `offset` to page through larger results. Opt-in source-context bodies include
`sourceContextTruncated`, `sourceContextOmitted` and `sourceContextBytes` so
clients can distinguish complete, truncated and omitted evidence. Regression
tests focus on latest
applicable scores, one-read-snapshot consistency, malformed FTS input,
provenance-only repositories, subpath identity matching, bounded nested
evidence, validated pagination and stable order.
