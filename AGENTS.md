# Project Guidance for Agents

## Repository structure highlights

- `src/api/*` exposes public entry points that orchestrate the feature services.
- `src/features/*` contains domain services (summaries, scoring, ingest) that expect injected deps for testability.
- `src/lib/*` holds shared adapters (database, environment helpers, logging, Ollama bindings).
- `scripts/*` includes coverage helpers (`coverage-report.ts`, `test-codecov.ts`) and operational wrappers.
- `sql/` provides schema migrations consumed by the ingest pipelines.

## Testing & coverage workflow

- Use `CI=1 bun test` for the complete suite. `bunfig.toml` enables coverage collection and preloads `test-setup.ts` to restore process and environment state between tests.
- Bun writes consolidated text and LCOV coverage to `coverage/`; tests, mocks, and `src/__test__/helpers` are excluded from coverage.
- Use `bun run coverage:report` to summarize the current unified run. Do not merge per-suite LCOV files.

## Linting

- Run `CI=1 bun lint --fix` before committing to keep CI green and avoid formatting drift.

## Build

- Run `CI=1 bun run build` and `CI=1 bun run check` to catch build and type regressions before pushing.

## Operational notes

- CLI entry lives in `src/cli.ts`; orchestrator scripts (pm2, etc.) should call the built `dist/cli.js` after running `bun run build`.
- Long-running APIs emit typed progress events (`ProgressEmitter` in `src/api/public.types.ts`)—tests typically stub these rather than asserting on console output.
- Environment access goes through `resolveModelConfig` / `resolveGithubToken` / `getRequiredEnv`; prefer these helpers to direct `Bun.env` reads when adding surfaces.

Keep additions consistent with the current option interfaces and favour dependency injection over singleton imports.
