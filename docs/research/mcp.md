# Geekist Stars MCP

Stars is available through the existing Geekist MCP Hub at
`https://mcp.geekist.co/mcp`. The endpoint remains behind the shared Cloudflare
Access owner OAuth flow. In ChatGPT web, add a custom MCP server, enter this
URL, choose OAuth, then review the discovered tools. No Stars-specific token is
needed. The current ChatGPT connection flow is documented in the [OpenAI
connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

The Hub prefixes these tools with `stars__`. Tools have typed inputs and
descriptions that state their data source and effects.

## Research and catalogue reads

- `stars__stars_overview` reports catalogue and research coverage, saved score
  freshness, and discovery availability.
- `stars__stars_search_repositories` searches the saved catalogue by text,
  list, topic, language, stars, score, metadata and coverage.
- `stars__stars_repository_profile` returns saved metadata, summaries, topics,
  list membership, score history, provenance and discovery references. README
  and evidence bodies are opt-in and bounded.
- `stars__stars_explore_topics` lists saved topics or resolves aliases,
  related topics and associated repositories.
- `stars__stars_search_discoveries` retrieves saved discovery targets, source
  references and previous research. Evidence bodies are opt-in.

These tools read stored Stars data; they do not refresh GitHub or fill missing
research. Empty or incomplete results report the observed coverage rather than
inventing evidence.

## GitHub fetches and ingestion

- `stars__stars_fetch_lists` reads the configured GitHub account's current
  Lists and metadata.
- `stars__stars_fetch_list_repositories` reads repositories from one exact
  GitHub List.
- `stars__stars_fetch_starred_repositories` reads the account's starred
  repositories.
- `stars__stars_get_unlisted_repositories` lists unlisted repositories already
  present in the local catalogue.
- `stars__stars_ingest_all`, `stars__stars_ingest_list_repositories`, and
  `stars__stars_ingest_unlisted_repositories` fetch from GitHub and write
  repository data and memberships to the local SQLite catalogue. Ingestion
  does not delete stale catalogue rows.

Fetch tools only read GitHub. Ingestion tools write local catalogue data. The
host's authenticated `gh` identity is used internally; credentials are not
tool arguments or results.

## Summaries, scores and topics

- `stars__stars_summarise_repositories` and
  `stars__stars_summarise_repository` use the host's configured model. Both
  default to `dry_run=true`; set it to false to save generated summaries.
- `stars__stars_score_repositories` and
  `stars__stars_score_repository` default to `dry_run=true`. Applying scores
  saves score history and can update GitHub List membership under the configured
  curation policy.
- `stars__stars_enrich_topics` reads repository topics and writes refreshed
  topic metadata, aliases and relationships to the local catalogue.

Model and GitHub credentials stay on the host. Mutating long-running operations
queue on the existing Stars run lock for up to 24 hours. If the SaaS candidate
pipeline or another Stars job owns it, the MCP job stays queued and starts when
that operation releases the lock; it does not fail immediately or overlap.

## Setup operations and job control

- `stars__stars_get_prompts` reads fixed Stars prompt configuration;
  `stars__stars_get_prompt_state` checks whether it matches its template; and
  `stars__stars_update_prompts` regenerates those fixed local prompt files.
- `stars__stars_get_model_config` reads the saved model name and endpoint,
  without returning API keys. `stars__stars_set_model_config` replaces the
  saved config. It accepts only an HTTP(S) endpoint without embedded
  credentials; omitted fields are cleared.
- `stars__stars_test_model_connectivity` probes the configured model service.
- `stars__stars_operation_status` lists queued, running or completed jobs, or
  retrieves a job by its returned
  id. `stars__stars_cancel_operation` removes a queued job before it starts, or
  stops a running worker. This is not a rollback; changes already committed
  locally or applied to GitHub remain.

Long-running operations return a job id promptly. Poll status to retrieve the
final bounded result. Repository/list fetch results include at most 25 items
per operation response and report truncation when applicable. Tool input sizes
and batch counts are constrained by the schemas.

## Host path and checks

The research API and operation dispatcher bind only to `127.0.0.1:8788`. The
research queries use the existing SQLite research handlers; action requests
accept a finite operation allowlist and validated JSON fields. They cannot
select a database path, run SQL or shell commands, access arbitrary files, or
provide GitHub/model credentials. The existing Fedora MCP SDK adapter calls
these fixed routes. The shared Rust Gateway bridges stdio to Streamable HTTP;
the Hub forwards it under the `stars__` prefix. The raw API and Gateway have no
public route.

Public MCP traffic continues through the existing Cloudflare Access owner
OAuth, Worker and Tunnel route. A public unauthenticated MCP request must
receive an HTTP 401 Bearer challenge. Use the existing endpoint in ChatGPT and
refresh its tool catalogue after an update.

Operational checks:

```sh
systemctl --user status geekist-stars-research-api.service stars-research-mcp-gateway.service mcp-hub.service
curl --fail http://127.0.0.1:8788/health
curl -i https://mcp.geekist.co/mcp
```

The first operation smoke test should inspect active jobs and use a fetch or
dry-run scoring/summary tool. Start ingestion or an apply-mode model operation
only when its stated effects are intended.
