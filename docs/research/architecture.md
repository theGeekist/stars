# Stars research architecture

Readback date: 2026-11-28. This records the merged implementation and the
verified Fedora deployment state inspected for S01–S03.

## Existing data and research

Stars stores catalogue and research evidence in SQLite. `sql/schema.sql`
defines repositories, lists and memberships, topics and aliases/relationships,
per-repository scoring runs, discovery targets, source observations, provenance
and retained discovery research. `src/api/research.ts` implements five
read-only HTTP capabilities: overview, repository search, repository profile,
topic exploration and discovery retrieval.

The host database is `/var/lib/geekist-local/repolists.db`. The running
`geekist-stars-research-api.service` uses `src/research-server.ts`, opens this
database read-only and binds only to `127.0.0.1:8788`. It serves `/health` and
`/research/*`; it does not start schema setup, expose administrative routes or
accept arbitrary SQL. The general Bun server retains its default port 8788, but
the dedicated research unit and its explicit port are the deployment
authority.

The read-only health check returned `{"ok":true,"readOnly":true}`. The
live overview at 2026-11-28 04:36 +08 reported 2,690 repositories, 13 lists,
1,116 memberships, 724 listed and 1,966 unlisted repositories; 34 summaries,
57 READMEs, 2,642 tagged repositories and 19,441 topic links. The latest
scoring run is run 29 from `2026-11-27T20:10:47.760Z`, but it has zero
repositories with attached scores. Discovery tables are available with 5,070
targets, 5,352 current source edges, zero retained research results and 122
provenance sources. These counts describe current stored research, not a claim
that all catalogue entries have complete or fresh research.

## MCP and authentication boundary

The existing ChatGPT endpoint is `https://mcp.geekist.co/mcp`. Cloudflare
Access owner OAuth and the `geekist-mcp-auth` Worker front the shared tunnel;
the tunnel forwards to the loopback Geekist MCP Hub at
`127.0.0.1:18774/mcp`. The Hub aggregates Streamable HTTP MCP upstreams. The
shared Rust Gateway bridges stdio MCP servers to Streamable HTTP.

Stars now uses that existing path. `stars-research-mcp-gateway.service` serves
the five typed Stars tools on loopback port 18779 and is registered as a
read-only Hub upstream. The Hub publishes them with the `stars__` prefix. The
raw Stars API and the local Gateway have no public route; public requests still
pass through the existing owner-only Access OAuth boundary. An unauthenticated
request to `https://mcp.geekist.co/mcp` returned HTTP 401 with a Bearer OAuth
challenge. Internal Hub initialization, tool discovery and research calls
passed. An authenticated browser call through the public boundary remains to be
verified in ChatGPT; the browser-control host was unavailable during this
readback.

## Delivery boundaries

- S01 records the actual host architecture and coverage; it does not establish
  completeness or freshness beyond stored timestamps.
- S02 hardens the existing research handlers while retaining SQLite and the
  HTTP route contract.
- S03 exposes only fixed, typed, read-only research tools over the existing
  Gateway and Hub. Calls do not invoke GitHub or mutate the catalogue.
- S04–S06 remain separate discovery, demand-intelligence and research-reuse
  work. None is a prerequisite for using current catalogue evidence.
- S00 remains separate. The active SaaS candidate pipeline was not restarted,
  and no new list reconciliation or ingestion was run during this delivery.

## Operational readback

At 05:05 +08, `geekist-stars-research-api.service`,
`stars-research-mcp-gateway.service` and `mcp-hub.service` were active. The
SaaS candidate pipeline had been running since 2026-11-28 02:19 +08 and had
progressed through index 68; index 69 was in progress. Summary stages saved at
indices 57–58 and 67, with scoring failures reported as `Invalid LLM response`.
Summary timeouts at indices 52–54 and 68 skipped scoring. The 03:00 topics
service run failed at 03:10 after its ten-minute lock wait, while an earlier run
refreshed 6,562 topics. Lock contention with the active pipeline is a likely
explanation, not a proven failure cause. Neither pipeline was retried or
restarted; the read-only API alone was restarted to load the reviewed handler.
