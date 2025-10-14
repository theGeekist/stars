# Framework Accessibility & API Surface Audit (2025 Refresh)

## Scope & method

We reviewed the public API modules (`summarise.public.ts`, `ranking.public.ts`, `stars.public.ts`, `ingest.public.ts`), the shared types/utilities in `public.types.ts`, and the dynamic dispatcher. The analysis focuses on developer-accessibility: naming consistency, option surfaces, error semantics, composability, and refactor readiness.

## Current strengths

- **Shared summarise runner.** `runSummariseRows` centralises iteration, persistence, and hook support so the public API and CLI reuse the same pipeline while emitting the standard `summarising:repo` progress events.【F:src/api/summarise.runner.ts†L1-L94】【F:src/api/summarise.public.ts†L18-L110】【F:src/api/summarise.ts†L77-L152】
- **Modular ranking apply flow.** Dedicated helpers for score persistence, membership planning, and GitHub updates now power `runRankingForRepo`, making unit tests lighter and error handling clearer.【F:src/api/ranking.public.ts†L68-L212】
- **Verb-centric progress vocabulary.** Ingest, stars, ranking, and summarise modules emit `verbing:subject` phases with optional `detail` statuses, aligning telemetry filters and orchestration scripts.【F:src/api/public.types.ts†L45-L71】【F:src/api/ingest.public.ts†L9-L86】【F:src/api/ranking.public.ts†L24-L193】【F:src/api/stars.public.ts†L13-L146】
- **Typed progress detail payloads.** A shared `ProgressStatus` union and structured `ProgressDetail` replace ad-hoc strings, so listeners can exhaustively handle lifecycle changes across ingest, lists, and stars.【F:src/api/public.types.ts†L45-L88】【F:src/api/ingest.public.ts†L1-L86】【F:src/api/stars.public.ts†L1-L137】
- **Normalised stars DTOs.** All stars fetchers now return `{ items, stats }` payloads with counts and timestamps, with each list item exposing a stable `slug` and optional `listId` for downstream joins.【F:src/api/stars.public.ts†L13-L86】
- **Summarise hooks exported.** `summarise.public.ts` re-exports `SummariseExecutionHooks` and the run context so orchestrators can subscribe to before/after callbacks without reaching into private modules.【F:src/api/summarise.public.ts†L1-L210】【F:src/api/summarise.runner.ts†L1-L129】
- **Documented option precedence.** Public interfaces call out the override order between injected dependencies, per-call configs, and environment fallbacks, reducing ambiguity when wiring new consumers.【F:src/api/summarise.public.ts†L18-L60】【F:src/api/ranking.public.ts†L21-L85】
- **Centralised environment and model resolution.** `resolveModelConfig`, `resolveGithubToken`, and `getRequiredEnv` encapsulate Bun env access, trimming inputs and surfacing actionable `ConfigError`s for missing credentials, which keeps option interfaces clean and future proofs alternative env providers.【F:src/api/public.types.ts†L101-L205】
- **Data-driven dispatcher.** `dispatchCommand` routes through a typed handler table, eliminating downcasts and documenting extension steps inline, which makes CLI and orchestration scripts safer to evolve.【F:src/api/dispatch.ts†L1-L108】

## Remaining risks

- **List metadata lookup duplicates network work.** `fetchReposFromList` now enriches responses with `listId`, but it requires an extra `collectListMetas` pass per invocation. Without caching or DI, repeated calls may re-fetch the entire list catalog.【F:src/api/stars.public.ts†L49-L86】
- **Summaries DB injection lacks integration coverage.** `runSummariseRows` respects injected databases for README caching, but the new hooks remain untested in an end-to-end scenario, so regressions could slip past unit suites.【F:src/api/summarise.runner.ts†L60-L125】
- **Ranking helper exports still indirect.** `persistScores`, `planMembershipChange`, and `applyMembership` ship as shared ops, yet only batch flows exercise them, making error messaging changes risky without direct unit tests.【F:src/api/ranking.public.ts†L125-L205】

## Opportunities for composability & extensibility

- **Cache list metadata.** Allow callers to inject pre-fetched list metas (or memoise internally) so `fetchReposFromList` can reuse `listId` lookups across invocations without re-querying GitHub.【F:src/api/stars.public.ts†L49-L86】
- **Ship summarise integration tests.** Add a focused suite that runs `summariseAll` with an injected database and hooks to confirm README caching respects the provided connection and emits expected events.【F:src/api/summarise.runner.ts†L60-L125】
- **Directly test ranking helpers.** Extract lightweight unit tests for `persistScores`, `planMembershipChange`, and `applyMembership` to lock down error semantics and blocked-plan scenarios.【F:src/api/ranking.public.ts†L125-L205】

## Actionable next steps

1. **Memoise list metadata.** Add an optional `metas` cache parameter (or internal memo) to `fetchReposFromList` so repeated calls don’t trigger full `collectListMetas` re-fetches.【F:src/api/stars.public.ts†L49-L86】
2. **Exercise summarise hooks end-to-end.** Build an integration test that injects hooks and a temp database to ensure README caching and hook payloads behave under concurrent runs.【F:src/api/summarise.runner.ts†L60-L125】
3. **Unit-test ranking repo ops.** Cover the exported repo operations with isolated tests (persist success/failure, apply blocked plans) to freeze behaviour ahead of future policy tweaks.【F:src/api/ranking.public.ts†L125-L205】
