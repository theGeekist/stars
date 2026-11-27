---
id: s01-research-architecture
title: S01 — Research capability and architecture audit
stage: research
status: review
priority: normal
evidence_milestone: s01-research-architecture-evidence
depends_on: []
decision_dependencies: []
conflicts_with: []
write_scope:
  - .taskgraph/tasks/s01-research-architecture.md
  - docs/research/architecture.md
required_reading:
  - path: src/index.ts
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/api/dispatch.ts
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/server.ts
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: sql/schema.sql
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: docs/pipeline.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/features/discovery/README.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
review_owner: human
updated_at: "2026-11-28"
---

# S01 — Research capability and architecture audit

## Objective

Establish what Stars can expose immediately and what is genuinely missing. Inspect live host deployment and existing MCP conventions, without changing them. Map catalogue, curated lists, topic relations, source observations, discovery work, retained research and GitHub transports to reusable contracts. Include actual database coverage and freshness where accessible; distinguish source code from operational state. Inspect existing HTTP query and access boundaries. Compare direct SDK calls with adapters; no new database or service assumed.

## Acceptance

- Inventory implemented capabilities, missing contracts, current auth boundary, operational deployment and actual access limitations.
- Provide a minimal read-first tool surface and staged implementation boundaries for S02–S05, with bounded examples and acceptance checks.
- Record material gaps with an actionable test or resolution; no broad rewrite and no deployment commissioned in this task.

## Delivery evidence

- Read the merged PR #6, its review findings, Fedora estate runbook, Stars service runbook, MCP Hub and shared Gateway conventions.
- Verified actual database path and service port: `/var/lib/geekist-local/repolists.db`, `127.0.0.1:8788`, dedicated read-only research unit.
- Recorded current coverage and research gaps in `docs/research/architecture.md`; source code and live service state are distinguished.
- Reused the existing MCP Hub, loopback Gateway and Cloudflare Access route. No separate public endpoint was added.
- Validation: local health and overview reads succeeded; public unauthenticated MCP returned 401 with OAuth challenge. Internal authenticated-owner browser call remains unverified because browser control was unavailable.

## Review references

- PR: https://github.com/theGeekist/stars/pull/7
- Human acceptance is pending.
