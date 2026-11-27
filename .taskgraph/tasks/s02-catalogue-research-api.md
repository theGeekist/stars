---
id: s02-catalogue-research-api
title: S02 — Shared catalogue research API
stage: implementation
status: review
priority: normal
evidence_milestone: s02-catalogue-research-api-evidence
depends_on:
  - s01-research-architecture
decision_dependencies: []
conflicts_with: []
write_scope:
  - .taskgraph/tasks/s02-catalogue-research-api.md
  - src/features/research
  - src/api/research.public.ts
  - src/api/dispatch.ts
  - src/index.ts
  - src/server.ts
  - docs/research/catalogue-api.md
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
  - path: docs/research/architecture.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
review_owner: human
updated_at: "2026-11-28"
---

# S02 — Shared catalogue research API

## Objective

Provide one typed domain query surface for existing catalogue research. Reuse FTS, structured filters, topic associations, list membership, source observations and retained research where supported. Extract/reuse existing HTTP query logic rather than duplicate SQL for MCP. Explicit database injection, bounded pagination, stable identities and deterministic ordering. Distinguish unavailable, missing and stale data; return observation time and provenance where known. Use minimal additions justified by S01. Keep current HTTP behaviour compatible.

## Acceptance

- Search, repository detail, related topic/collection lookup, and evidence retrieval support bounded inputs and typed outputs with source and coverage metadata.
- Test malformed search, filters, empty/partial results, curated versus discovered relationships, pagination and isolated databases; never fabricate freshness or membership.
- Demonstrate existing HTTP compatibility and SDK usage; keep side-effectful refresh/ranking outside read-only operations.

## Delivery evidence

- Reused `src/api/research.ts` and its existing SQLite contract. No second query layer or schema change was introduced.
- Corrected per-repository latest score selection, consistent deferred read transactions, malformed FTS evaluation, provenance-only and subpath/identity matches, bounded nested evidence/history, input validation, and stable ordering.
- Added six focused regression tests for the review findings and partial/missing research behavior.
- Validation on Fedora host: `CI=1 bun run build`, `CI=1 bun lint --fix`, and `CI=1 bun test` all passed; full suite reported 381 passed, 0 failed, 912 expectations.
- Live API reads were read-only; snapshot on 2026-11-28 04:36 +08 is recorded in `docs/research/architecture.md`.

## Review references

- PR: https://github.com/theGeekist/stars/pull/7
- Human acceptance is pending.
