---
id: s05-demand-intelligence
title: S05 — GitHub demand and maintenance evidence
stage: implementation
status: ready
priority: normal
evidence_milestone: s05-demand-intelligence-evidence
depends_on:
  - s01-research-architecture
decision_dependencies: []
conflicts_with: []
write_scope:
  - .taskgraph/tasks/s05-demand-intelligence.md
  - src/features/demand-intelligence
  - src/api/demand-intelligence.public.ts
  - docs/research/demand-intelligence.md
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

# S05 — GitHub demand and maintenance evidence

## Objective

Provide targeted acquisition and retrieval of public issue, discussion, feature request, release and maintenance observations. Start from a bounded research question and representative repositories; inspect actual API coverage (including disabled issues/discussions) and reuse transport/evidence infrastructure. Distinguish user requests, maintainer responses, reactions, duplicate issues, workarounds, closed/rejected requests and existing competing solutions. Preserve links, timestamps, state and exact source observations; do not infer demand from stars alone or treat issue counts as market size. No outreach, paid calls or unauthorised scraping.

## Acceptance

- Demonstrate bounded evidence collection for a real research question, with contrary evidence and explicit omissions; return source IDs/URLs, observation time and state.
- Test missing/disabled sources, duplicate threads, edited/closed evidence and rate limits. Distinguish independent corroboration from copied claims.
- Provide reusable typed retrieval and a concise example research handover. Coordinate MCP integration as an incremental addition, not a gate for S03.
