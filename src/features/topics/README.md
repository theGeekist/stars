# Topics Feature

Normalises repo topics, reconciles repo↔topic links, and **refreshes topic metadata** from a local `github/explore`–backed API.
Runs entirely **locally** against SQLite; no network calls are made here.

- **DI-first**: every dependency (selectors, upserts, meta fetcher) can be injected for tests.
- **Two phases**:
  1. **Repo topics reconciliation** (per repo) → builds a **universe** of topic slugs.
  2. **Metadata refresh** (per topic) with TTL to limit work.

---

## Import / DI

```ts
import { createTopicsService } from "@features/topics";

const topics = createTopicsService(
  /* deps?: Partial<Deps> */ {},
  /* database?: Database */
);
```

- `deps` _(optional)_: overrides from `./api` (e.g. mock `topicMetaMany`, `reconcileRepoTopics`, etc.).
- `database` _(optional)_: `Database` from `bun:sqlite`; if omitted, `withDB()` opens the default DB.

---

## Environment

- `TOPIC_TTL_DAYS` (default **30**) — max age before a topic’s metadata is considered stale.
- `TOPIC_REPO_CONCURRENCY` (default **4**) — concurrency for `repoTopicsMany`.

Both can be overridden per-call (see `enrichAllRepoTopics`).

---

## Public API

```ts
type TopicsService = {
  listRepoRefs: (onlyActive?: boolean) => RepoMini[]; // DB select of repos (id, name_with_owner, is_archived)
  enrichAllRepoTopics: (opts?: { onlyActive?: boolean; ttlDays?: number }) => {
    repos: number;
    unique_topics: number;
    refreshed: number;
  };
};
```

### Types (excerpt)

```ts
type RepoMini = { id: number; name_with_owner: string; is_archived: 0 | 1 };
type RepoRef = { owner: string; name: string };

type Deps = {
  // Normalisation & reconciliation
  normalizeTopics: (topics: string[]) => string[];
  reconcileRepoTopics: (
    repoId: number,
    topics: string[],
    db?: Database,
  ) => void;

  // Repo -> topics extractor
  repoTopicsMany: (
    refs: RepoRef[],
    opts: { concurrency: number },
    db?: Database,
  ) => Map<string /* name_with_owner */, string[] /* topics */>;

  // Topic metadata
  selectStaleTopics: (
    universeJson: string,
    ttlDays: number,
    db?: Database,
  ) => Array<{ topic: string }>;
  topicMetaMany: (
    topics: string[],
    _unusedTokenObj: {},
  ) => Map<
    string,
    {
      name?: string;
      displayName?: string;
      shortDescription?: string;
      longDescriptionMd?: string;
      isFeatured?: boolean;
      createdBy?: string | null;
      released?: string | null;
      wikipediaUrl?: string | null;
      logo?: string | null;
      aliases?: string[];
      related?: string[];
    }
  >;

  // Upserts
  upsertTopic: (
    row: {
      topic: string;
      display_name: string | null;
      short_description: string | null;
      long_description_md: string | null;
      is_featured: boolean;
      created_by: string | null;
      released: string | null;
      wikipedia_url: string | null;
      logo: string | null;
      etag: string | null;
    },
    db?: Database,
  ) => void;

  upsertTopicAliases: (topic: string, aliases: string[], db?: Database) => void;
  upsertTopicRelated: (topic: string, related: string[], db?: Database) => void;
};
```

---

## Behaviour

### `listRepoRefs(onlyActive?: boolean): RepoMini[]`

- DB query:

  ```sql
  SELECT id, name_with_owner, is_archived
  FROM repo
  WHERE is_archived = 0 -- only when onlyActive === true
  ```

- Returns minimal repo rows for subsequent processing.

### `enrichAllRepoTopics({ onlyActive, ttlDays }?)`

1. **Load repos** via `listRepoRefsFromDb(onlyActive)`.
2. **Build RepoRefs** (splits `name_with_owner` → `{ owner, name }`; throws if invalid).
3. **Extract topics** per repo via `repoTopicsMany(refs, { concurrency }, db)`.
4. **Normalise and reconcile**:
   - `normalizeTopics` cleans slugs.
   - `reconcileRepoTopics(repoId, ts)` updates the `repo_topics` mapping.
   - While reconciling, collect a **universe** `Set<string>` of all normalised topics.

5. **Refresh topic metadata** for **stale** entries only:
   - Staleness via `selectStaleTopics(JSON.stringify([...universe]), ttlDays)`.
   - Fetch in bulk via `topicMetaMany(stale, {})` (token param kept but unused).
   - For **each** topic:
     - If no meta → upsert a **minimal** topic row (`display_name = topic`, no aliases/related).
     - Else upsert canonical record and **also**:
       - `upsertTopicAliases(canonical, aliases)`
       - `upsertTopicRelated(canonical, related)`

**Return value**:
`{ repos: <processed count>, unique_topics: <universe size>, refreshed: <num stale refreshed> }`

---

## Internal helpers (available in the module)

- `getConfiguredTtlDays(override?)` → number
- `getConfiguredRepoConcurrency()` → number
- `listRepoRefsFromDb(onlyActive?, database?)` → `RepoMini[]`
- `buildRepoRefs(rows)` → `RepoRef[]` (validates `name_with_owner`)
- `getTopicsByRepo(refs, repoTopicsMany, concurrency, db)` → `Map<string, string[]>`
- `reconcileRowsAndCollectUniverse(rows, topicsByRepo, normalizeTopics, reconcileRepoTopics)` → `Set<string>`
- `refreshStaleTopicMeta(universe, ttlDays, selectStaleTopics, topicMetaMany, upsertTopic, upsertTopicAliases, upsertTopicRelated)` → `number` (count refreshed)

Each helper is pure or side-effecting only through injected deps and DB.

---

## Programmatic Usage

```ts
import { createTopicsService } from "@features/topics";

const svc = createTopicsService();

// Enrich all repos (active only), with default TTL from env
const res = svc.enrichAllRepoTopics({ onlyActive: true });
console.log(
  `repos=${res.repos} unique_topics=${res.unique_topics} refreshed=${res.refreshed}`,
);
```

Override TTL (e.g. force refresh within 7 days):

```ts
svc.enrichAllRepoTopics({ ttlDays: 7 });
```

Inject mocks (tests):

```ts
const svc = createTopicsService({
  normalizeTopics: (ts) => ts.map((t) => t.toLowerCase()),
  repoTopicsMany: (refs) =>
    new Map(refs.map((r) => [`${r.owner}/${r.name}`, ["ai", "rag"]])),
  selectStaleTopics: () => [{ topic: "ai" }, { topic: "rag" }],
  topicMetaMany: (ts) =>
    new Map(
      ts.map((t) => [
        t,
        { name: t, displayName: t.toUpperCase(), aliases: [], related: [] },
      ]),
    ),
  upsertTopic: () => {},
  upsertTopicAliases: () => {},
  upsertTopicRelated: () => {},
  reconcileRepoTopics: () => {},
});
const res = svc.enrichAllRepoTopics();
```

---

## Edge Cases & Guarantees

- **Invalid `name_with_owner`** → `buildRepoRefs` throws (prevents silent bad joins).
- **Universe is empty** → returns `{ repos: N, unique_topics: 0, refreshed: 0 }` quickly.
- **Missing meta** → inserts minimal topic row (FK-safe) with no aliases/related.
- **Canonicalisation** → uses `meta.name` (if present) as the canonical “topic” key; aliases/related are attached to that canonical.
- **Token hygiene** → `topicMetaMany` receives an **unused** token object (`{}`) to preserve signature compatibility.
- **Deterministic** → Staleness is computed strictly from TTL and universe membership; re-running without TTL expiry will **not** thrash the DB.

---

## CLI Mapping

This feature powers:

- `gk-stars topics:enrich [--active] [--ttl <days>]`
  → calls `enrichAllRepoTopics({ onlyActive, ttlDays })`

- `gk-stars topics:report`
  → reads the resulting `topics`, `topic_alias`, `topic_related`, and `repo_topics` tables (separate feature).

---

## Suggested DB Shapes (for context)

- `repo(id, name_with_owner, is_archived, topics JSON, …)`
- `repo_topics(repo_id, topic TEXT, …)` (reconciled here)
- `topics(topic PK, display_name, short_description, long_description_md, is_featured, created_by, released, wikipedia_url, logo, etag, updated_at, …)`
- `topic_alias(topic, alias)`
- `topic_related(topic, related)`

(Exact schema lives in your migrations.)
