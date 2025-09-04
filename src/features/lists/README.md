# Lists Feature

Utilities and services for working with GitHub **Lists** and local membership.
Provides **read** helpers (candidates to categorise, current membership, list defs/IDs) and **apply** helpers (reconcile local DB, push to GitHub via GraphQL).

- Local storage: SQLite (via `withDB`)
- Remote ops: GitHub GraphQL (`updateUserListsForItem`)
- DI-friendly: inject `Database` and a `ghGraphQL` runner for tests

---

## Installation / Import

```ts
import { Database } from "bun:sqlite";
import { createListsService } from "@features/lists";
```

---

## Factory

```ts
createListsService(
  database?: Database,
  ghGraphQL?: <T>(token: string, query: string, vars?: Record<string, unknown>) => Promise<T>
): ListsService
```

- `database` – optional. If omitted, `withDB()` opens the default DB.
- `ghGraphQL` – optional. Defaults to `githubGraphQL`. Useful for mocking in tests.

> Note: `read.getAll` and `read.getAllStream` use `Bun.env.GITHUB_TOKEN`. Other remote calls take an explicit `token`.

---

## Public API

### Read

```ts
// 1) Stream/Fetch raw GitHub Lists (requires GITHUB_TOKEN env)
read.getAll(): Promise<ListsEdgesPage>
read.getAllStream(): AsyncGenerator<ListsEdgesPage, void, unknown>

// 2) Local list definitions (excludes “valuable-resources” and “interesting-to-explore”)
read.getListDefs(): Promise<{ slug: string; name: string; description: string }[]>

// 3) Candidate repos to categorise (ordered by popularity, then freshness)
read.getReposToScore({ limit?: number; listSlug?: string }): Promise<RepoRow[]>

// 4) Current local membership (slugs) for a repo
read.currentMembership(repoId: number): Promise<string[]>

// 5) Map list slugs → GitHub list global IDs (cached in DB)
read.mapSlugsToGhIds(slugs: string[]): Promise<string[]>
```

**Behaviour notes**

- `getReposToScore({ listSlug, limit })`
  - If `listSlug` provided: returns repos in that list.
  - Else: returns global candidates from `repo`, ordered by `popularity DESC, freshness DESC`.
  - `limit` is coerced to `>= 1` (default 10).

- `getListDefs()` filters out the two catch-all lists to keep your categoriser focused.

### Apply

```ts
// 6) Reconcile local membership: make list_repo match exactly the given slugs
apply.reconcileLocal(repoId: number, slugs: string[]): Promise<void>

// 7) Push membership to GitHub (GraphQL updateUserListsForItem)
apply.updateOnGitHub(token: string, repoGlobalId: string, listIds: string[]): Promise<void>

// 8) Ensure list GitHub IDs in DB (list.list_id) by matching viewer’s list names
apply.ensureListGhIds(token: string): Promise<Map<string, string>> // slug -> ghListId

// 9) Ensure repo’s GitHub global ID (repo.repo_id), fetching if missing
apply.ensureRepoGhId(token: string, repoId: number): Promise<string> // returns R_kg...
```

**Behaviour notes**

- `reconcileLocal`:
  - Inserts any missing `(list,repo)` pairs.
  - **Deletes** any other memberships for that repo not present in `slugs`.
  - Run this _after_ you’ve decided the final set of slugs for the repo.

- `ensureListGhIds`:
  - Paginates through the viewer’s lists and matches by **name** (case-insensitive).
  - Updates `list.list_id` where missing; returns a `Map<slug, list_id>`.

- `ensureRepoGhId`:
  - If `repo.repo_id` already looks like a GitHub global ID (`/^R_kg/`), returns it.
  - Else queries `repository(owner,name)` and caches the ID in `repo.repo_id`.

- `updateOnGitHub`:
  - Executes the mutation:

    ```graphql
    mutation UpdateUserListsForItem($itemId: ID!, $listIds: [ID!]!) {
      updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
        lists {
          id
          name
        }
      }
    }
    ```

---

## Types (excerpt)

```ts
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

type ListsService = {
  read: {
    getAll: () => Promise<ListsEdgesPage>;
    getAllStream: () => AsyncGenerator<ListsEdgesPage, void, unknown>;
    getListDefs: () => Promise<
      { slug: string; name: string; description: string }[]
    >;
    getReposToScore: (sel: {
      limit?: number;
      listSlug?: string;
    }) => Promise<RepoRow[]>;
    currentMembership: (repoId: number) => Promise<string[]>;
    mapSlugsToGhIds: (slugs: string[]) => Promise<string[]>;
  };
  apply: {
    reconcileLocal: (repoId: number, slugs: string[]) => Promise<void>;
    updateOnGitHub: (
      token: string,
      repoGlobalId: string,
      listIds: string[],
    ) => Promise<void>;
    ensureListGhIds: (token: string) => Promise<Map<string, string>>;
    ensureRepoGhId: (token: string, repoId: number) => Promise<string>;
  };
};
```

---

## Programmatic Usage

### Basic read

```ts
import { createListsService } from "@features/lists";

const svc = createListsService(); // uses default DB and githubGraphQL

const defs = await svc.read.getListDefs();
const repos = await svc.read.getReposToScore({
  limit: 5,
  listSlug: defs[0].slug,
});
const currentSlugs = await svc.read.currentMembership(repos[0].id);
```

### Reconcile locally, then push to GitHub

```ts
const token = process.env.GITHUB_TOKEN!;
const repoId = repos[0].id;

// Decide target slugs (from your categoriser output)
const targetSlugs = ["ai-machine-learning", "automation-workflows"];

// 1) Make local DB match exactly these slugs
await svc.apply.reconcileLocal(repoId, targetSlugs);

// 2) Ensure IDs for remote mutation
const ghListIds = await svc.read
  .mapSlugsToGhIds(targetSlugs)
  .then((ids) =>
    ids.length
      ? ids
      : svc.apply
          .ensureListGhIds(token)
          .then((map) => targetSlugs.map((s) => map.get(s)!)),
  );
const repoGlobalId = await svc.apply.ensureRepoGhId(token, repoId);

// 3) Push to GitHub
await svc.apply.updateOnGitHub(token, repoGlobalId, ghListIds);
```

### Dependency injection (custom DB / mock GraphQL for tests)

```ts
import { Database } from "bun:sqlite";

const db = new Database(":memory:");
const mockGraphQL = async <T>(
  token: string,
  query: string,
  vars?: Record<string, unknown>,
) => {
  // return a shape compatible with the query expected in tests
  return {} as T;
};

const svc = createListsService(db, mockGraphQL);
```

---

## CLI (related)

- `gk-stars lists [--json] [--out <file>] [--dir <folder>]`
  Fetch all GitHub Lists and their repos.

- `gk-stars repos --list <name> [--json]`
  Show repositories for one list by **name** (case-insensitive).

---

## Gotchas & Notes

- **Name vs slug matching**: `ensureListGhIds` matches by **name** to populate `list.list_id`. Keep list names stable to avoid mismatches.
- **Local reconcile is authoritative**: `reconcileLocal(repoId, slugs)` will **remove** any memberships not in `slugs`. If you only want to add without removing, call `insert` logic directly or extend the service.
- **Ordering for candidates**: `getReposToScore` favours `popularity` then `freshness`. If you need “oldest first” or “unseen first”, add a selector in the query.
- **Env token**: `read.getAll*` requires `Bun.env.GITHUB_TOKEN`. Other mutations take a `token` param explicitly.
- **Two lists excluded from defs**: `valuable-resources` and `interesting-to-explore` are filtered out by `getListDefs()` to reduce noise in categorisation runs.
