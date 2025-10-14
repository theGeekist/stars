# Framework Accessibility & Extensibility Audit

_Last reviewed: 2025-10-14_

## Scope & approach

- Surveyed the public API layer (`summarise`, `ranking`, `stars`, `ingest`) and supporting utilities to judge naming, dependency injection, and runtime ergonomics.
- Inspected shared contracts (`ProgressEmitter`, `ModelConfig`, `ConfigError`) to understand how external callers hook into long-running workflows.
- Focused on extensibility and composability opportunities that would keep the surfaces future-proof while avoiding unnecessary churn.

## Architectural touchpoints

- Public options expose consistent verb-forward naming (`summariseAll`, `rankOne`, etc.) and typed progress hooks that report `verbing:subject` phases, enabling uniform orchestration across features.【F:src/api/public.types.ts†L52-L107】【F:src/api/dispatch.ts†L1-L76】
- Batch runners encapsulate side-effects: summarisation iterates rows with injectable hooks and DB overrides, while ranking composes a runtime that mediates scoring, list services, and GitHub side-effects in one place.【F:src/api/summarise.runner.ts†L12-L129】【F:src/api/ranking.public.ts†L35-L200】
- Environment and model resolution helpers centralise token/model precedence, trim unsafe input, and throw typed `ConfigError`s instead of exiting—making the APIs resilient when embedded elsewhere.【F:src/api/public.types.ts†L26-L43】【F:src/api/public.types.ts†L215-L296】

## Consistency & naming

- Functions favour `verbAll`/`verbOne` patterns for batch vs. targeted operations, matching dispatcher keys and reducing mental overhead when wiring CLI or orchestration layers.【F:src/api/dispatch.ts†L25-L76】
- Options interfaces group shared concerns (`db`, `logger`, `onProgress`, `modelConfig`) in predictable positions, though comments occasionally carry behavioural nuance (e.g., precedence rules) that might be better codified in types.
- Progress payloads deliver structured detail with status enums rather than free-form strings, lowering the risk of consumer breakage when phases expand.【F:src/api/public.types.ts†L52-L107】

## Accessibility & composability

- Dependency injection is available at every entry point (custom LLMs, DB handles, execution hooks), which keeps surfaces testable and adaptable for future engines or storage changes.【F:src/api/summarise.runner.ts†L37-L129】【F:src/api/ranking.public.ts†L35-L131】
- Dispatcher table converts string keys into strongly typed handler invocations, enabling scripting interfaces or RPC layers without compromising type safety.【F:src/api/dispatch.ts†L1-L93】
- The shared `ProgressEmitter` and result DTOs give downstream tooling (CLI, PM2 scripts, dashboards) predictable shapes for logging, retries, or UI updates.【F:src/api/public.types.ts†L52-L162】

## Complexity & future-proofness

- Batch runners currently stitch together orchestration logic inline (looping, error handling, persistence). Extracting reusable primitives (e.g., generic `runBatch`) could further reduce duplication as new workflows appear.
- Ranking’s runtime builder already separates data gathering, scoring, and side-effects, making it a good template for future features that need staged preparation before iteration.【F:src/api/ranking.public.ts†L85-L200】
- Reliance on environment variables is shielded by helpers, but coordinating env discovery across CLI, server, and workers would benefit from documented precedence tables or configuration objects to avoid drift.【F:src/api/public.types.ts†L215-L296】

## Risks & friction points

- Progress phases remain stringly-typed beyond the union `ProgressStatus`; if additional verbs are introduced, consumers will need up-to-date mapping. Publishing a canonical list or helper constants would de-risk this.
- Comments communicate critical behaviour (e.g., “Provide either `llm` or `modelConfig`”), leaving room for misuse without compile-time enforcement.【F:src/api/ranking.public.ts†L28-L60】
- Summarise runner temporarily rebinds the global DB connection when a custom handle is passed, which could surprise concurrent consumers if shared in multi-tenant contexts.【F:src/api/summarise.runner.ts†L55-L129】

## Actionable next steps

1. **Codify option precedence in types** – Introduce discriminated unions for mutually exclusive fields like `llm` vs. `modelConfig` to prevent invalid combinations at compile time.【F:src/api/ranking.public.ts†L35-L116】
2. **Publish progress phase constants** – Export string literal helpers (`PROGRESS_PHASES`) so orchestration layers can avoid typo-prone string comparisons.【F:src/api/public.types.ts†L52-L107】
3. **Factor reusable batch executor** – Extract an iterator helper that accepts `select`, `process`, and `persist` callbacks to remove duplicate control flow between summarise, ranking, and future ingest operations.【F:src/api/summarise.runner.ts†L55-L129】【F:src/api/ranking.public.ts†L133-L200】
4. **Centralise configuration manifests** – Provide a documented config builder (JSON/YAML schema) for env discovery so PM2/server scripts can validate inputs before spawning long-running jobs.【F:src/api/public.types.ts†L215-L296】
5. **Document multi-tenant DB handling** – Clarify expectations when swapping databases in summarise/ingest flows, and consider scoped contexts instead of global mutation for safer concurrency.【F:src/api/summarise.runner.ts†L55-L129】
