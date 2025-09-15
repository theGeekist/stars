# Changelog

## 0.1.1 (Unreleased)

### Added

- Public API modules: `summaries`, `ranking`, `starsData`, `ingest`, `setup`, plus typed `dispatchCommand`.
- Comprehensive JSDoc coverage for all public entry points and shared types.
- `ConfigError` for configuration failures instead of process exit.
- Progress event hooks with consistent `phase` taxonomy (summarising, ranking, lists:fetch, stars:page, ingest:\*).
- Per-request model override via `modelConfig` for summaries and ranking.
- Dispatcher with discriminated `DispatchKind` and mapped argument types (no `any`).
- Wiki feature README and internal documentation refinements.

### Changed

- Normalized inline comments to NOTE style; removed obsolete comments.
- Formatter configuration updated (`.biome.json`) to use `lineWidth: 90` and relaxed wrapping.
- Ranking results now include granular flags: `scoresPersisted`, `membershipApplied`, `blocked`, `blockReason`, `fallbackUsed`, `changed`.
- Summaries and ranking return structured batch results `{ items, stats }`.

### Deprecated

- Legacy functions: `summariseBatchAll`, `summariseOne`, `scoreBatchAll`, `scoreOne`, `runLists`, `runRepos`, `runStars`, `runUnlisted` (retained with JSDoc @deprecated tags).
- `saved` flag in ranking items (use `scoresPersisted` + `membershipApplied`).

### Internal

- Build script compiles public API + CLI via Bun (`bun build`).
- Tests: 117 passing across features (summaries, ranking, ingest, topics, scoring, setup, CLI, metrics, services).
- Lint & types clean (no warnings; strict mode).

### Migration Notes

See `MIGRATION.md` for code-level mapping of old → new API calls, dispatcher usage, and progress phases.

---

## 0.1.0

- Initial internal release (baseline CLI and feature set).
