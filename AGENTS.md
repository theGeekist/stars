# Project Guidance for Agents

## Repository structure highlights

- `src/api/*` exposes public entry points that orchestrate the feature services.
- `src/features/*` contains domain services (summaries, scoring, ingest) that expect injected deps for testability.
- `src/lib/*` holds shared adapters (database, environment helpers, logging, Ollama bindings).
- `scripts/*` includes coverage helpers (`coverage-report.ts`, `test-codecov.ts`) and operational wrappers.
- `sql/` provides schema migrations consumed by the ingest pipelines.

## Testing & coverage workflow

- The default `bun test` target is intentionally unused; run focused groups via `bun run test:cli`, `bun run test:lib`, and `bun run test:main`.
- For coverage, execute the scoped scripts in order: `bun run test:cli:cov`, `bun run test:lib:cov`, `bun run test:main:cov`, then merge with `bun run coverage:merge`.
- Each suite writes to `coverage/`—the merge step overwrites `coverage/lcov.info`. Clean the directory if switching between coverage and plain runs.
- Race conditions arise when multiple suites share sqlite fixtures; avoid invoking a monolithic `bun test` or the coverage scripts in parallel.

## Linting

- Run `bun run lint` before committing to keep CI green and avoid formatting drift.

## Build

- Run `bun run build` locally (or at least `bun run scripts/build.ts`) to catch type generation/build regressions before pushing.

## Operational notes

- CLI entry lives in `src/cli.ts`; orchestrator scripts (pm2, etc.) should call the built `dist/cli.js` after running `bun run build`.
- Long-running APIs emit typed progress events (`ProgressEmitter` in `src/api/public.types.ts`)—tests typically stub these rather than asserting on console output.
- Environment access goes through `resolveModelConfig` / `resolveGithubToken` / `getRequiredEnv`; prefer these helpers to direct `Bun.env` reads when adding surfaces.

Keep additions consistent with the current option interfaces and favour dependency injection over singleton imports.
