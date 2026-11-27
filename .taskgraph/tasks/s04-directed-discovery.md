---
id: s04-directed-discovery
title: S04 — Directed GitHub discovery beyond curated Stars
stage: implementation
status: ready
priority: normal
evidence_milestone: s04-directed-discovery-evidence
depends_on:
  - s01-research-architecture
decision_dependencies: []
conflicts_with: []
write_scope:
  - .taskgraph/tasks/s04-directed-discovery.md
  - src/features/directed-discovery
  - src/api/directed-discovery.public.ts
  - docs/research/directed-discovery.md
required_reading:
  - path: src/lib/github.ts
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/api/discovery.public.ts
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/features/discovery/README.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: docs/research/architecture.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
review_owner: human
updated_at: "2026-11-28"
---

# S04 — Directed GitHub discovery beyond curated Stars

## Objective

Research and implement a bounded directed repository discovery capability using existing GitHub transport and search. Compare live keyword/topic search with local FTS and collection relationships. Return new repository candidates with canonical identity, query/source provenance, pagination, timestamps, rate-limit and coverage signals. Do not require a star or a list membership to appear in results; do not automatically ingest, star, or classify candidates. Retain only authorised evidence under explicit persistence semantics. Coordinate integration with shared API/MCP without blocking the initial MCP release.

## Acceptance

- Demonstrate discovery for a known local match and at least one beyond-catalogue candidate using bounded public queries (or record the exact blocked live check with fixture results).
- Test aliases, missing/archived repos, pagination, partial/rate-limited results and distinction between candidate and curated record.
- Document query coverage and retry/caching boundaries; evidence from GitHub search is a lead, not a verified market claim.
