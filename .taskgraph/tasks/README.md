# Native task briefs

Use `tg overview`, `tg plan`, `tg context <qualified-task-id>` and `tg inspect <qualified-task-id>` from the repository root. Read all governing and task-specific files before work. Coordinate overlapping paths and actual prerequisites; scope hints are not locks or permissions. New work begins ready. Submit evidence and checks in review; record human acceptance and transition to done before the authorised merge. Do not mark a task done for an unrun check. Keep provisional findings distinct from accepted evidence. Follow AGENTS.md and existing host conventions.

| Packet | Native task                   | Prerequisites |
| ------ | ----------------------------- | ------------- |
| S00    | s00-reconciliation-acceptance | none          |
| S01    | s01-research-architecture     | none          |
| S02    | s02-catalogue-research-api    | S01           |
| S03    | s03-research-mcp              | S02           |
| S04    | s04-directed-discovery        | S01           |
| S05    | s05-demand-intelligence       | S01           |
| S06    | s06-research-reuse-evaluation | none          |
