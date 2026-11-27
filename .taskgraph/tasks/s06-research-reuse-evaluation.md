---
id: s06-research-reuse-evaluation
title: S06 — Research reuse and M07 dogfooding
stage: research
status: ready
priority: normal
evidence_milestone: s06-research-reuse-evaluation-evidence
depends_on: []
decision_dependencies: []
conflicts_with: []
write_scope:
  - .taskgraph/tasks/s06-research-reuse-evaluation.md
  - docs/research/reuse-evaluation
required_reading:
  - path: docs/pipeline.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/features/discovery/README.md
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: src/api/discovery.public.ts
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
  - path: sql/schema.sql
    reason:
      Use existing implementation and task-specific context; predecessor deliverables
      are required once available.
review_owner: human
updated_at: "2026-11-28"
---

# S06 — Research reuse and M07 dogfooding

## Objective

Use Stars as a real specimen for reusable research infrastructure. SaaS Research M07 is ready, not accepted; its brief is an informative cross-project reference: https://github.com/theGeekist/saas-research/blob/main/.taskgraph/tasks/m07-market-infrastructure.md. M07 owns comparative findings and the required B01/B04 two-output specimen; Stars supplies bounded technical evidence and does not replace that scope. Read the current M07 brief and accepted references as applicable, recording exact revisions. Share evidence IDs with M07; do not make either task a scheduling dependency of the other.

Select one concrete GitHub research question (e.g. gallery-dl duplicate detection or streamlink scheduling). Freeze query set, source cut-off, corpus and evaluation criteria. Compare independent discovery via existing authorised GitHub/web tools with Stars-assisted retrieval plus targeted fresh search. Run with current Stars capabilities first; if MCP is available, include it as a separate arm rather than waiting for it. Use a small judged query set, with known relevant/irrelevant examples, misses, false positives and one stale or changed observation. Use equal decision criteria and preserve evidence provenance. Check whether a second agent can reconstruct the conclusion and next action from retained sources without the original conversation.

## Acceptance

- Produce versioned run receipts, source/claim links, judged retrieval results, actual time/API/token costs where observable, and coverage/quality comparison. Separate unmeasured costs from observations; include preparation, revalidation, adaptation and shared upkeep in a consistent resource unit.
- Produce a compact research brief and an internal build/evidence projection from the same sources. Do not fabricate a customer or actual willingness to pay; M07 may adapt the specimen within its own B01/B04 requirements.
- Record useful gaps as concrete recommendations to open Stars tasks; avoid assuming a new graph database, embedding service or report engine. Publish the specimen and exact references for M07, including counterexamples and cases where fresh discovery wins.
