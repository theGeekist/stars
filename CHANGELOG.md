# Changelog

## 0.5.0 (2025-09-30)

### Added

- **Service Factory Standardization**: All service factories now use the standardized `makeCreateService` utility for consistent dependency injection
- **Improved Developer Experience**: Services can now be created with simple `createService()` calls using sensible defaults
- **Enhanced Type Safety**: Consolidated duplicate types across the codebase, reducing type duplication from 7% to below 3%

### Changed

- **BREAKING**: Service factory signatures now use options objects instead of positional parameters:
  - `createScoringService(database)` → `createScoringService({ db: database })` or `createScoringService()`
  - `createStarsService(api, db, ghQL, opts)` → `createStarsService({ db, token })` or `createStarsService()`
  - `createSummariseService(database)` → `createSummariseService({ db: database })` or `createSummariseService()`
  - `createTopicsService(deps, database)` → `createTopicsService({ db: database })` or `createTopicsService()`
  - `createIngestService(database)` → `createIngestService({ db: database })` or `createIngestService()`
- **Standardized Dependencies**: All services now receive `{ db, exec, token }` through the create-service utility
- **Cleaner APIs**: Services no longer require empty objects `{}` - they can be called with no parameters for default behavior

### Added for Testing

- **Internal Service Factories**: Added `*ServiceInternal` variants for tests requiring custom dependency injection:
  - `createStarsServiceInternal(api, db, ghQL, opts)` for custom GitHub API injection
  - `createTopicsServiceInternal(deps, db)` for custom topic API dependency injection

### Internal

- **Architecture Improvement**: Leveraged the previously underused `makeCreateService` utility across all service factories
- **Consistent Patterns**: Unified service creation patterns improve maintainability and reduce cognitive overhead
- **Better Testability**: Standardized dependency injection makes mocking and testing more consistent

### Migration

See [MIGRATION.md](MIGRATION.md#v050---service-factory-standardization-and-type-consolidation) for detailed migration instructions.

---

## 0.4.1 (2025-09-30)

### Fixed

- Resolved TypeScript compilation errors across multiple files
- Fixed `parseStringArray` function signature to handle `string | string[] | null | undefined` input types
- Corrected missing type re-exports in feature modules (`scoring/types.ts`, `stars/types.ts`)

### Changed

- Consolidated duplicate utility functions to reduce code duplication
- Moved `parseStringArray` and `wordCount` functions to single source of truth in `@lib/utils`
- Updated import statements to use centralized utility functions
- Removed `any` type usage in test files in favor of proper type checking

### Internal

- Improved type safety across API and library modules
- Enhanced test coverage and eliminated type casting in tests
- Streamlined utility function organization and imports

---

## 0.4.0 (2025-09-28)

### Removed

- **BREAKING**: `CURATION_POLICY` constant has been completely removed in favor of the more flexible `--curation-threshold` CLI flag
- Deprecated functionality has been cleaned up throughout the codebase

### Changed

- Curation threshold is now controlled exclusively via `--curation-threshold N` CLI flag (default 0.1)
- Updated CLI help and documentation to reflect curation threshold changes
- Fixed and enabled previously skipped tests in curation functionality

### Added

- Comprehensive CLI usage documentation in `USAGE.md` with `--curation-threshold` examples
- Enhanced curation test coverage with proper threshold validation

### Internal

- Refactored curation tests to work with new threshold system
- Updated test fixtures to use correct default threshold values

---

## 0.3.5 (2025-09-26)

### Added

- **🆕 Enhanced Ingest Pipeline**: Automatic cleanup of repositories no longer starred
  - Removes repositories that are no longer in your GitHub stars during ingest
  - **Safe**: Preserves repositories with `repo_overrides` entries (manual curation protection)
  - **Automatic**: Runs by default in all ingest operations (`ingest`, `ingest:lists`, `ingest:unlisted`)
  - **Defensive**: Gracefully handles test environments and missing GitHub tokens
  - Comprehensive test coverage with 11 new unit tests and integration tests
- Captured preferred "what's new" surfaces during ingest and stars/list exports by enriching GraphQL payloads (releases, changelog hints, discussions, commit samples). Stored as `repo.updates_json` alongside new `RepoInfo.updates` metadata

### Changed

- Ingest operations now include a 3-phase process: Fetch → Upsert → Cleanup
- Enhanced logging shows cleanup summary: removed vs preserved repositories
- Test environment detection prevents GitHub API calls during testing
- Standardised GitHub repo mapping via a shared fragment and mapper, ensuring both CLI exports and public APIs expose watcher counts, latest release data, and update candidates
- Removed legacy `run*` and `summarise*` wrappers in favour of core APIs, simplifying CLI wiring while keeping `./exports` as the persistent cache

### Internal

- Added `cleanupRemovedStars()` method to ingest service
- Integrated cleanup with stars service for current GitHub star collection
- Updated ingest feature documentation with cleanup behavior
- All 243 tests passing including new cleanup functionality
- Extended migrations to backfill the new `updates_json` column and updated ingestion/upsert statements. Added unit coverage for mapper changes and ingest persistence

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
