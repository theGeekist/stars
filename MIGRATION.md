# Migration Guide

## Overview

This release introduces a cleaner, library-focused public API while preserving existing CLI-oriented functions (now deprecated). The new APIs:

- Use option objects (future-proof) without breaking existing positional calls.
- Return structured results (for summaries now; ranking will expand in a later refactor).
- Avoid `process.exit` in new code paths.
- Provide explicit getters for stars and lists data.

## New Public Entry Points

Imported via the package root:

```ts
import {
  summaries,
  ranking,
  starsData,
  ingest,
  ConfigError,
} from "@geekist/stars";
```

### Summaries

| Old                                                  | New                                                               | Notes                      |
| ---------------------------------------------------- | ----------------------------------------------------------------- | -------------------------- |
| `summariseBatchAll(limit, apply, deps?, opts?, db?)` | `summaries.summariseAll({ limit, apply, resummarise, deps, db })` | returns `{ items, stats }` |
| `summariseOne(selector, apply, deps?, db?)`          | `summaries.summariseRepo({ selector, apply, deps, db })`          | returns item result        |

### Ranking (formerly scoring)

| Old                                      | New                                                      | Notes                                                           |
| ---------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `scoreBatchAll(limit, apply, llm?, db?)` | `ranking.rankAll({ limit, apply, llm, db, onProgress })` | returns per-repo items with scores, planned lists, change flags |
| `scoreOne(selector, apply, llm?, db?)`   | `ranking.rankOne({ selector, apply, llm, db })`          | returns single repo result                                      |

### Stars / Lists

| Old                                  | New                                      | Notes                                            |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------ |
| `runLists(json, out?, dir?)`         | `starsData.fetchLists()`                 | pure data; throws `ConfigError` if missing token |
| `runRepos(listName, json)`           | `starsData.fetchReposFromList(listName)` | pure data                                        |
| `runStars(json, out?, dir?)`         | `starsData.fetchStars()`                 | pure data                                        |
| `runUnlisted(json, out?, dir?, db?)` | `starsData.fetchUnlistedStars(db)`       | uses DB to compute                               |

### Ingest

| Old                                     | New                                                | Notes                                           |
| --------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `ingest(dir?) (default export)`         | `ingest.ingestAll({ dir, db })`                    | structured return identical to old `ingestCore` |
| `ingestListedFromGh(db?)`               | `ingest.ingestListsOnly({ db })`                   | alias retained                                  |
| `ingestUnlistedFromGh(db?)`             | `ingest.ingestUnlistedOnly({ db })`                | alias retained                                  |
| `ingestFromData(lists, unlisted?, db?)` | `ingest.ingestFromMemory(lists, unlisted, { db })` | wrapper                                         |

## Deprecated Functions

All deprecated functions remain exported but are tagged with JSDoc `@deprecated`. They will be removed in a future major version:

- `summariseBatchAll`, `summariseOne`
- `scoreBatchAll`, `scoreOne`
- `runLists`, `runRepos`, `runStars`, `runUnlisted`

## New Shared Types

Available via root import:

- `ConfigError`
- `ProgressEvent`
- `BatchResult<T>` / `BatchStats`
- `SummaryItemResult`, `RankingItemResult`

## Error Handling Changes

New APIs throw `ConfigError` instead of calling `process.exit` when environment variables (e.g. `GITHUB_TOKEN`) are missing. Wrap calls:

```ts
try {
  const lists = await starsData.fetchLists();
} catch (e) {
  if (e instanceof ConfigError) {
    // handle missing config
  }
}
```

## Summary Results Example

```ts
const res = await summaries.summariseAll({ limit: 10, apply: false });
console.log(res.stats); // { processed, succeeded, failed, saved }
for (const item of res.items) {
  if (item.status === "ok") console.log(item.paragraph);
}
```

## Progress Hooks

All major batch operations support progress callbacks:

- `summaries.summariseAll({ onProgress })` → phase `summarising`
- `ranking.rankAll({ onProgress })` → phase `ranking`
- `starsData.fetchLists({ onProgress })` → phase `lists:fetch`
- `starsData.fetchStars({ onProgress })` → phase `stars:page`
- `ingest.ingestAll({ onProgress })`, `ingest.ingestListsOnly`, `ingest.ingestUnlistedOnly`, `ingest.ingestFromMemory` → phases prefixed with `ingest:`

### Phase Reference

| Domain    | Phase           | Meaning                                                  |
| --------- | --------------- | -------------------------------------------------------- |
| summaries | summarising     | Generating a repository summary                          |
| ranking   | ranking         | Scoring a repository against all lists & applying policy |
| lists     | lists:fetch     | Streaming each list definition from GitHub               |
| stars     | stars:page      | Processing a page of starred repositories                |
| ingest    | ingest:lists    | Persisting listed repositories + lists into DB           |
| ingest    | ingest:unlisted | Persisting starred (unlisted) repositories into DB       |
| ingest    | ingest:topics   | Reconciling & normalising topics (if performed)          |
| ingest    | ingest:done     | Final bookkeeping / stats persistence                    |

## Unified Dispatcher

For dynamic invocation (CLI / plugin systems) use:

```ts
import { dispatchCommand } from "@geekist/stars";
await dispatchCommand("summaries:all", { args: { limit: 20 } });
```

Kinds supported: `summaries:all`, `summaries:one`, `ranking:all`, `ranking:one`, `stars:lists`, `stars:listRepos`, `stars:stars`, `stars:unlisted`, `ingest:all`, `ingest:lists`, `ingest:unlisted`.

### Dispatcher Typing (Refactored)

The dispatcher maps each `kind` to a concrete option interface (no `any`). To extend:

1. Export a typed options interface in the new public module.
2. Add the discriminant to the internal `DispatchArgsMap`.
3. Implement a `case` forwarding the typed object.
   This centralizes type errors for new commands and prevents silent drift.

## Ranking Result Metadata

Each `RankingItemResult` now includes:

- `scores`: list scoring results with optional rationale
- `plannedLists`: final planned membership
- `changed`: whether membership was updated (when apply=true)
- `blocked` / `blockReason`
- `fallbackUsed` (policy fallback, if any)
- `scoresPersisted`: whether scores were stored (separate from membership)
- `membershipApplied`: whether GitHub list membership was updated
- `saved` (deprecated): retained for back-compat; equivalent to `scoresPersisted && (!changed || membershipApplied)`

### Backward Compatibility

Use `scoresPersisted` + `membershipApplied` instead of legacy `saved` to differentiate score storage from membership changes.

## Next Steps (Potential)

- Expose detailed ranking result items (planned lists, changed flag, errors).
- Unify selection logic into reusable services for summaries & ranking.
- Provide streaming async iterators for large batch operations.

## Versioning

Treat adoption of new APIs as preparation for a future `1.0.0` where deprecated symbols may be removed.

---

Feel free to open an issue for any migration friction or missing data needs.

## Per-Request LLM Configuration (`modelConfig`)

You can override the LLM model / host / apiKey per invocation (no env mutation required).

Supported:

```ts
await ranking.rankAll({
  modelConfig: {
    model: "llama3:latest",
    host: "http://ollama.internal:11434",
    apiKey: "sek",
  },
});
await ranking.rankOne({
  selector: "owner/repo",
  modelConfig: { model: "llama3:custom" },
});
await summaries.summariseAll({ modelConfig: { model: "summariser-model" } });
await summaries.summariseRepo({
  selector: "owner/repo",
  modelConfig: { model: "summariser-model" },
});
```

Precedence (ranking & summarise):

1. Explicit `llm` (ranking) or `deps` (summaries)
2. `modelConfig`
3. Environment variables (legacy fallback)

Notes:

- Summaries still rely on env embedding model unless you inject `deps.embed`.
- `apiKey` populates `Authorization: Bearer <apiKey>` header.
- Ranking adapter parses JSON; parse failure → item `error` (tested).
- Summaries adapter returns raw text (no JSON parse step).

### ModelConfig Validation

`modelConfig` requires a `model` string. Other fields are passed through to runtime adapters. Malformed model outputs (ranking JSON) result in per-item `error` status; batches continue.

Tests:

- `src/api/ranking.config.test.ts` (single repo DI)
- `src/api/ranking.rankAll.test.ts` (multi repo + invalid output path)
- `src/api/summarise.config.test.ts` (summary DI)

Migration tip: Start by passing `modelConfig` where you previously relied on switching `OLLAMA_MODEL` between runs. Keep env for defaults.

## Lint / Quality Policy

Production code compiles with zero Biome warnings and contains no `// biome-ignore` pragmas (tests may use them). Avoid introducing `any`; prefer explicit option objects.

## Inline Comment Convention

Only rationale or non-obvious decisions use a `NOTE:` prefixed inline comment. Historical comments tied to removed behaviors were deleted during migration.
