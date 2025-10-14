# Ingest Feature

Imports exported GitHub Lists (and optional `unlisted.json`) into the local SQLite corpus.
Normalises repo records, computes lightweight health signals, reconciles duplicates, and links repos to lists.

- **Local-first**: all writes go to SQLite via `withDB`.
- **Deterministic merge policy**: prefers `repo_id` rows; moves list links when merging by name.
- **Signals**: popularity, freshness, activeness, plus derived `tags`.
- **Order matters**: **UNLISTED FIRST**, then **LISTS** (lists win on conflicts).
- **🆕 Automatic Cleanup**: removes repositories no longer starred while preserving manual overrides.

## 🆕 Enhanced Cleanup Feature

The ingest pipeline now automatically **removes repositories that are no longer starred** on GitHub while preserving those with manual customizations:

### Safety Guarantees

- **Manual Curation Protected**: Repositories with entries in `repo_overrides` are never removed
- **Source Filtering**: Only affects repositories with GitHub `repo_id` (ignores manual entries)
- **Atomic Operations**: Database transactions ensure data consistency
- **Graceful Degradation**: Continues ingest even if cleanup fails

### When Cleanup Runs

Cleanup is automatically performed during:

- `ingesting:lists+unlisted` (main ingest from exports + cleanup)
- `ingesting:lists` (GitHub lists + cleanup)
- `ingesting:unlisted` (unlisted repositories + cleanup)

### Implementation

```ts
const service = createIngestService();
const result = service.cleanupRemovedStars(currentStarIds);
// Returns: { removed: number, preserved: number, checkedCount: number }
```

The cleanup compares your current GitHub stars with the local database and removes repositories that are:

1. No longer starred on GitHub
2. Have a valid `repo_id` (GitHub-sourced)
3. Do **not** have entries in `repo_overrides` (manual curation)

---

## Import / DI

```ts
import { createIngestService } from "@features/ingest";

const svc = createIngestService({ db: database }); // Database from create-service utility
```

- `database` _(optional)_: if omitted, `withDB()` opens the default DB.
- No network calls here: this feature only reads local exports.

---

## Public API

```ts
type IngestReporter = {
  start?: (listsCount: number) => void;
  listStart?: (meta: IndexEntry, i: number, total: number, repos: number) => void;
  listDone?: (meta: IndexEntry, repos: number) => void;
  done?: (x: { lists: number; repos: number }) => void;
};

createIngestService().ingestFromExports(
  dir: string,
  reporter?: IngestReporter
): Promise<{ lists: number; reposFromLists: number; unlisted: number }>;

// 🆕 New cleanup functionality
createIngestService().cleanupRemovedStars(
  currentStarIds: Set<string>
): { removed: number; preserved: number; checkedCount: number };
```

**Behaviour**

- Reads `dir/unlisted.json` (optional) **first**.
- Reads `dir/index.json` and each listed file (`meta.file`) **after**.
- Validates shapes strictly; throws with explicit messages if anything is off.
- Upserts lists and repos; links list↔repo; computes signals and tags.
- **🆕 Automatic cleanup** now runs in main ingest flow when GitHub token available.
- Returns counts: number of lists ingested, total repos added/updated from lists, and number of unlisted repos processed.

**Cleanup Policy**

- **Removes**: repositories with `repo_id` that are no longer in your current GitHub stars
- **Preserves**: repositories with entries in `repo_overrides` table (manual curation protection)
- **Ignores**: repositories with `repo_id = NULL` (manual entries)
- **Safe**: removes list relationships before repository deletion
- **Automatic**: runs by default during all ingest operations (`ingesting:*`)

---

## File Formats

- `exports/index.json` → `IndexEntry[]`

  ```ts
  type IndexEntry = {
    name: string;
    description: string | null;
    isPrivate: boolean;
    file: string; // e.g. "ai-machine-learning.json"
    listId: string; // GitHub list global ID (required)
  };
  ```

- `exports/<list>.json` → `StarList`

  ```ts
  type StarList = {
    listId: string; // may mirror meta.listId
    repos: RepoInfo[];
  };
  ```

- `exports/unlisted.json` → `RepoInfo[]`

All three are **strictly validated**. Missing or malformed fields throw.

---

## Normalisation & Signals

`normaliseRepo(r: RepoInfo): UpsertRepoBind` maps raw export to DB columns and computes:

- **popularity** = `scorePopularity(stars, forks, watchers)`
- **freshness** = `scoreFreshnessFromISO(chooseFreshnessSource(...), 90)`
- **activeness** = `scoreActiveness(openIssues, openPRs, pushedAt, { hasIssuesEnabled, isArchived })`
- **tags** = `deriveTags({ topics, primary_language, license, is_archived, is_fork, is_mirror })`

Other notes:

- `topics` and `languages` are JSON-stringified arrays for storage.
- README fields (`readme_md`, `readme_etag`, `readme_fetched_at`) and `summary` are **left null** at ingest; other features populate them later.
- Dates (`pushed_at`, `updated_at`, `created_at`, `last_commit_iso`, `last_release_iso`) persist as ISO strings when present.

---

## Merge / Upsert Policy

```txt
A) If both a row-by-name and a row-by-repo_id exist (and differ):
   - winner = node(row-by-repo_id)
   - move list links to winner
   - delete loser (name row)
   - force-update winner.name_with_owner to incoming value
   - update winner fields with incoming payload

B) If only one exists (by repo_id or by name): update it.

C) Else insert:
   - prefer insert by repo_id when available
   - otherwise insert by name_with_owner
```

This is implemented via:

- `upsertRepoSmart(bind, db)` (internal)
- prepared statements:
  - `upsertRepoById`, `upsertRepoByName`, `updateRepoFieldsById`
  - `selRepoByName`, `selRepoByNode`
  - `moveLinksToRepo`, `deleteRepoById`, `forceUpdateName`
  - `linkListRepo`

---

## Ingest Order & Conflict Resolution

1. **Unlisted** (`unlisted.json`)
   - Upsert repos **without** adding list links.

2. **Lists** (`index.json` + per-list files)
   - Upsert or merge repos again.
   - **Link** repos to the specific list (`list_repo`).
   - Because this runs **after** unlisted, **lists win** on any field conflicts.

This ensures “later” list membership and fresher fields override earlier unlisted-only data.

---

## Programmatic Usage

```ts
import { createIngestService } from "@features/ingest";

const svc = createIngestService();

const res = await svc.ingestFromExports("./exports", {
  start: (n) => console.log(`Starting ingest: ${n} lists`),
  listStart: (meta, i, total, repos) =>
    console.log(`[${i + 1}/${total}] ${meta.name} (${repos} repos)`),
  listDone: (meta, repos) => console.log(`Done ${meta.name}: ${repos} repos`),
  done: ({ lists, repos }) =>
    console.log(`Ingested ${lists} lists, ${repos} repos`),
});

console.log(
  `Lists=${res.lists} | FromLists=${res.reposFromLists} | Unlisted=${res.unlisted}`,
);
```

**Example log line you may print after ingest (unique-aware)**

```
✔ Ingest complete: 13 lists | 544 total | 427 listed (unique) | 117 unlisted | 117 duplicate placements
```

(Where _duplicate placements_ = sum of list sizes − unique listed.)

---

## Edge Cases & Guarantees

- **Missing `listId`**
  In `index.json` or per-list payload → **throws** with a helpful message including the list name/file.

- **Name change on GitHub**
  If a repo was previously saved by `name_with_owner` and later arrives with `repo_id`, the merge path **moves links** and **de-duplicates** cleanly.

- **Idempotency**
  Running ingest multiple times with the same payload produces the same DB state.

- **Performance**
  All hot paths use prepared statements and batched transactions; large lists ingest efficiently.

---

## CLI

This feature powers:

- `gk-stars ingest --dir ./exports`

Typical flow:

```bash
gk-stars lists --dir ./exports   # export lists/unlisted to JSON
gk-stars ingest --dir ./exports  # ingest into SQLite
```

---

## Internals (for maintainers)

- **Validators**: `assertIndexEntryArray`, `assertRepoInfo`, `assertRepoInfoArray`, `assertStarList`
- **Metrics**: `chooseFreshnessSource`, `scorePopularity`, `scoreFreshnessFromISO`, `scoreActiveness`, `deriveTags`
- **Utils**: `slugify`, `isObject`
- **Statements** prepared lazily in `prepareStatements(database)`
- **Transactions** wrap per-list and per-batch operations for atomicity.
