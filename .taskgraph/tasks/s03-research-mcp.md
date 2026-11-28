---
id: s03-research-mcp
title: S03 — Authenticated Stars research MCP
stage: implementation
status: in_progress
priority: normal
evidence_milestone: s03-research-mcp-evidence
depends_on:
  - s02-catalogue-research-api
decision_dependencies: []
conflicts_with: []
write_scope:
  - .taskgraph/tasks/s03-research-mcp.md
  - .gitignore
  - scripts/research_mcp.py
  - scripts/research-operation-runner.ts
  - src/research-server.ts
  - src/research-operations.ts
  - docs/research/mcp.md
  - docs/research/catalogue-api.md
  - docs/research/architecture.md
required_reading:
  - path: docs/research/architecture.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: docs/research/catalogue-api.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/index.ts
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: AGENTS.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
review_owner: human
updated_at: "2026-11-28"
---

# S03 — Authenticated Stars research MCP

## Objective

Expose the existing Stars catalogue, research, fetch, ingest, summarisation,
scoring and topic-enrichment operations through the shared MCP Hub and Gateway.
Reuse established host deployment, identity, routing and access conventions
discovered in S01. Use typed, bounded tool inputs with descriptions that state
data sources, persistence and external effects. Do not expose arbitrary SQL,
shell commands, filesystem paths or credentials. Keep long-running operations
observable and respect the shared Stars job lock.

## Acceptance

- Tool discovery and end-to-end calls from intended client(s) for catalogue search, repository detail, list/topic/collection exploration, retained evidence and every existing public task operation; clear empty/error results and pagination.
- Action tools state whether they read GitHub, write the local catalogue, call the configured model, or update GitHub list membership. Long-running jobs can be inspected and produce bounded results.
- Verify unauthorised calls fail and private data is not exposed beyond authorised identity; test schema limits, malformed inputs and timeouts.
- Document actual launch/configuration and operational smoke checks; record deployment evidence or name the exact access blocker. S04–S06 are not release prerequisites.

## Delivery evidence

- Initial revision added five bounded, typed research tools using the already-installed Fedora MCP SDK and existing stdio-to-Streamable-HTTP Gateway; no new SDK dependency. This scope is now expanded by the owner to include the existing Stars operations.
- Registered Stars in the existing MCP Hub; endpoint remains `https://mcp.geekist.co/mcp` behind existing Cloudflare Access owner OAuth. Raw API and Gateway bind only to loopback.
- Local MCP initialization, tool discovery and WordPress/spotDL research calls succeeded through the Hub. Public unauthenticated request returned HTTP 401 with a Bearer OAuth challenge.
- WordPress search returned 52 matches and related-topic results. spotDL resolved to `spotDL/spotify-downloader` (26,990 stars); profile has description and topics but zero score history, discovery targets and provenance. This absence is reported explicitly.
- Authentication through a signed-in ChatGPT browser remains unverified: the computer-use browser host returned unavailable. `docs/research/mcp.md` records the actual endpoint and connection steps.
- The existing S00 candidate pipeline remains active under the shared Stars run lock. It was left running and was never restarted. A harmless `ingest:all` MCP queue smoke test returned `queued`, then was cancelled before lock acquisition; its job receipt confirms ingestion never started.
- Root cause was lock contention being treated as an ingestion failure: scheduled refresh and draft units used `flock -n`, while topics and discovery-visibility gave up after 10 minutes. Their host units and tracked deployment source now wait up to 24 hours on the existing `/home/jasonjn/.local/state/geekist-stars/run.lock`, with a 48-hour systemd start timeout. API operations use that same lock and expose queued/running/cancelled job state. No new lock was introduced.
- Host verification: the API is active on its configured port, the S00 pipeline remains active, and the four installed units report the 24-hour wait command and 48-hour start timeout. The scheduled 06:00 refresh and 03:00 topics failures predate the correction and were not replayed while S00 held the lock.

## Review references

- PR: https://github.com/theGeekist/stars/pull/7 and https://github.com/theGeekist/mcp-hub/pull/2
- Human acceptance is pending.
