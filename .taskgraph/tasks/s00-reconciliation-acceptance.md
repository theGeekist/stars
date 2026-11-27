---
id: s00-reconciliation-acceptance
title: S00 — SaaS candidate reconciliation and pipeline acceptance
stage: operations
status: ready
priority: normal
evidence_milestone: s00-reconciliation-acceptance-evidence
depends_on: []
decision_dependencies: []
conflicts_with: []
write_scope:
  - .taskgraph/tasks/s00-reconciliation-acceptance.md
  - scripts/saas-stars.mjs
  - docs/saas-stars-reconciliation.md
  - scripts/saas-stars.test.mjs
required_reading:
  - path: docs/pipeline.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: docs/saas-stars-reconciliation.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: scripts/saas-stars.mjs
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
review_owner: human
updated_at: "2026-11-28"
---

# S00 — SaaS candidate reconciliation and pipeline acceptance

## Objective

Complete the existing PR #6 operation without changing the established local pipeline. Resolve candidate identities before mutation; preserve existing list memberships, count canonical repositories and confirmed additions once, report unclassified and missing lists, and do not create new lists. Review the pinned manifest and optional report leads; no hidden candidates during apply. Use the existing authenticated host and verified account. Do not run related-repository discovery or collection backfilling. Continue normal configured ingestion, research, enrichment, summarisation and scoring as applicable; do not suppress other stages. Do not invent a host command or reinstall the already configured environment.

## Acceptance

- Test dry-run no mutation, alias union, repeat apply/idempotence, missing lists, incomplete confirmation, and manifest validation with a mocked GitHub transport.
- Record live dry-run and apply receipts with account, manifest revision, canonical counts and exceptions; reconcile actual GitHub state before accepting. No new list creation or unstar operation.
- Capture existing pipeline stage results, excluding only related-repository discovery/collection backfilling, and distinguish failures from skipped steps. Do not claim live acceptance from a script test.
