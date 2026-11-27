---
id: s01-research-architecture
title: S01 — Research capability and architecture audit
stage: research
status: ready
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
