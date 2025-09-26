# Changelog

## 0.3.5 (2025-09-26)

### Added

- **🆕 Enhanced Ingest Pipeline**: Automatic cleanup of repositories no longer starred
  - Removes repositories that are no longer in your GitHub stars during ingest
  - **Safe**: Preserves repositories with `repo_overrides` entries (manual curation protection)
  - **Automatic**: Runs by default in all ingest operations (`ingest`, `ingest:lists`, `ingest:unlisted`)
  - **Defensive**: Gracefully handles test environments and missing GitHub tokens
  - Comprehensive test coverage with 11 new unit tests and integration tests

### Changed

- Ingest operations now include a 3-phase process: Fetch → Upsert → Cleanup
- Enhanced logging shows cleanup summary: removed vs preserved repositories
- Test environment detection prevents GitHub API calls during testing

### Internal

- Added `cleanupRemovedStars()` method to ingest service
- Integrated cleanup with stars service for current GitHub star collection
- Updated ingest feature documentation with cleanup behavior
- All 243 tests passing including new cleanup functionality

---

## 0.3.4 (Previous)

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
