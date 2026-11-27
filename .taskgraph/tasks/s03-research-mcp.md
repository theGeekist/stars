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
  - scripts/research_mcp.py
  - docs/research/mcp.md
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

Expose the initial Stars research surface through MCP using the shared API. Reuse established host deployment, identity, routing and access conventions discovered in S01. Choose transport and tool schemas appropriate for real ChatGPT/Codex consumers. Read-first, least authority, bounded responses, explicit coverage and evidence references. No arbitrary SQL, shell, filesystem paths, token exposure or implicit GitHub writes. Keep write tools out of the initial surface unless separately authorised and designed.

## Acceptance

- Tool discovery and end-to-end calls from intended client(s) for search, repository detail, list/topic/collection exploration and retained evidence; clear empty/error results and pagination.
- Verify unauthorised calls fail and private data is not exposed beyond authorised identity; test schema limits, malformed inputs and timeouts.
- Document actual launch/configuration and operational smoke checks; record deployment evidence or name the exact access blocker. S04–S06 are not release prerequisites.

## Delivery evidence

- Added five bounded, typed, read-only tools using the already-installed Fedora MCP SDK and existing stdio-to-Streamable-HTTP Gateway; no new SDK dependency.
- Registered Stars in the existing MCP Hub; endpoint remains `https://mcp.geekist.co/mcp` behind existing Cloudflare Access owner OAuth. Raw API and Gateway bind only to loopback.
- Local MCP initialization, tool discovery and WordPress/spotDL research calls succeeded through the Hub. Public unauthenticated request returned HTTP 401 with a Bearer OAuth challenge.
- WordPress search returned 52 matches and related-topic results. spotDL resolved to `spotDL/spotify-downloader` (26,990 stars); profile has description and topics but zero score history, discovery targets and provenance. This absence is reported explicitly.
- Authentication through a signed-in ChatGPT browser remains unverified: the computer-use browser host returned unavailable. `docs/research/mcp.md` records the actual endpoint and connection steps.
- No catalogue, GitHub account, or pipeline mutations were performed by research tool calls.
