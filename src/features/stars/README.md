# Stars Feature

Pulls your **GitHub Stars** via GraphQL and cross-checks them against the **local corpus** to find repos you’ve starred but **haven’t placed into any local list** yet.
Also exposes small DB helpers and a parity batch selector.

- **Local DB**: read-only helpers over SQLite (`withDB`)
- **Remote**: GitHub GraphQL via injected runner (defaults to `githubGraphQL`)
- **Diff**: computes “unlisted stars” by set-difference on **GitHub node IDs**

---

## Import / DI

```ts
import { createStarsService } from '@features/stars';
import * as starsLib from "@lib/stars";

const svc = createStarsService(
  starsLib,
  database?,          // optional Database from 'bun:sqlite'
  ghGraphQL?          // optional runner <T>(token, query, vars?) => Promise<T>
);
```

- If `database` is omitted, `withDB()` opens the default DB.
- If `ghGraphQL` is omitted, defaults to `githubGraphQL`.

> Remote pulls use `Bun.env.GITHUB_TOKEN`. Throw if missing where required.

---

## Public API

```ts
type StarsService = {
  read: {
    // Remote pulls (GitHub Stars)
    getAll: () => Promise<RepoInfo[]>; // one-shot
    getAllStream: () => AsyncGenerator<RepoInfo[], void>; // paginated stream
    collectStarIdsSet: () => Promise<Set<string>>; // GitHub node IDs

    // Local DB helpers / cross-source ops
    collectLocallyListedRepoIdsSet: () => Promise<Set<string>>; // repo.repo_id for any locally listed repo
    getUnlistedStars: () => Promise<RepoInfo[]>; // stars not in any local list

    // Parity helper (ordering identical to other features)
    getReposToScore: (sel: BatchSelector) => Promise<RepoRow[]>;
  };
};
```

### Types (excerpt)

```ts
type BatchSelector = { limit?: number }; // here: no listSlug filter, global only

type RepoRow = {
  id: number;
  name_with_owner: string;
  url: string;
  description: string | null;
  primary_language: string | null;
  topics: string[] | null;
  stars: number | null;
  forks: number | null;
  popularity: number | null;
  freshness: number | null;
  activeness: number | null;
  pushed_at: string | null;
  last_commit_iso: string | null;
  last_release_iso: string | null;
  updated_at: string | null;
  summary: string | null;
};

type RepoInfo = {
  repoId: string | null; // GitHub global ID (node id) — required for diff
  nameWithOwner: string;
  url: string;
  // ...stars/forks/watchers/issues/prs/etc (as exported by @lib/stars)
};
```

---

## Behaviour & Queries

### `read.getAll()` / `read.getAllStream()`

- Uses `getAllStars` / `getAllStarsStream(token, ghGraphQL)`.
- Requires `Bun.env.GITHUB_TOKEN`.
- Stream variant yields pages of `RepoInfo[]` for large star sets.

### `read.collectStarIdsSet()`

- Returns a `Set<string>` of **GitHub node IDs** for _all_ your starred repos (remote).

### `read.collectLocallyListedRepoIdsSet()`

- DB query:

  ```sql
  SELECT DISTINCT r.repo_id
  FROM repo r
  JOIN list_repo lr ON lr.repo_id = r.id
  WHERE r.repo_id IS NOT NULL
  ```

- Returns a `Set<string>` of **node IDs** for repos that are already in **any** local list.

### `read.getUnlistedStars()`

- Streams all stars from GitHub, flattens to `RepoInfo[]`.
- Builds the local **listed** set via `collectLocallyListedRepoIdsSet()`.
- **Set-diff**: include star if `repoId` exists **and** is **not** in the listed set.
- Skips entries without `repoId` (defensive).

> Output is perfect for producing `exports/unlisted.json` prior to `ingest`.

### `read.getReposToScore({ limit })`

- Pure DB read:

  ```sql
  SELECT ... FROM repo
  ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
  LIMIT ?
  ```

- Exists for **pipeline parity** with other features (same ordering).
- Coerces `limit >= 1` (default 10).

---

## Programmatic Usage

### Fetch “unlisted stars” for export

```ts
const starsSvc = createStarsService();

const unlisted = await starsSvc.read.getUnlistedStars();
// write to exports/unlisted.json for ingest to pick up
await Bun.write("./exports/unlisted.json", JSON.stringify(unlisted, null, 2));
```

### Build a local “star delta” report

```ts
const [remoteIds, localListedIds] = await Promise.all([
  starsSvc.read.collectStarIdsSet(),
  starsSvc.read.collectLocallyListedRepoIdsSet(),
]);

const newlyStarredButUnlisted = [...remoteIds].filter(
  (id) => !localListedIds.has(id),
);
console.log(`Unlisted stars by node id: ${newlyStarredButUnlisted.length}`);
```

### Batch for a follow-up task (parity selector)

```ts
const batch = await starsSvc.read.getReposToScore({ limit: 50 });
// feed into summariser or categoriser if desired
```

---

## Edge Cases & Notes

- **Token requirement**: All remote calls (`getAll*`, `collectStarIdsSet`, `getUnlistedStars`) require `GITHUB_TOKEN`. Throws if missing.
- **Node ID is authoritative**: Cross-source diffing uses `repoId` (GraphQL node ID). Items without it are skipped by `getUnlistedStars()` to avoid false positives.
- **Local listed check**: A repo is considered “listed” if it appears in **any** local list (`list_repo` join). This avoids double-suggesting items already curated elsewhere.
- **No writes**: The Stars feature **does not write** to DB. Ingestion and membership updates are handled by other features.

---

## Typical CLI Flow (how this feature is used)

While there is no direct `gk-stars stars` command, this feature underpins the **unlisted discovery** step:

```bash
# Export all lists (for context) and optionally write your unlisted stars:
gk-stars lists --dir ./exports
# (programmatic) write unlisted.json via stars service
# then ingest both:
gk-stars ingest --dir ./exports
```

Result: your DB now contains both **list-linked repos** and **unlisted repos**, ready for summarisation/categorisation.

---

## Internals (for maintainers)

- DB queries: `qReposDefault` and `qListedRepoNodeIds` mirror the schema used by other features for consistent ordering and identity.
- Remote helpers come from `@lib/stars`: `getAllStars`, `getAllStarsStream`, `collectStarIdsSet`.
- Dependency injection allows swapping the GraphQL runner and DB in tests.
