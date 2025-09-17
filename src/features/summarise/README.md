# Summarise Feature

Generates and stores **concise summaries** for repositories in the local DB.
Summaries are used by the **Scoring** step to reduce hallucinations and keep criteria grounded.

> LLM generation relies on external peers: install `@jasonnathan/llm-core` and `ollama` if you plan to call higher-level summarise public APIs. The core service here only selects & saves rows.

- **DB only**: selects repos and persists summaries.
- **LLM orchestration**: handled outside this service (e.g. via Ollama).
- **Policy**: only repos without summaries are selected, unless `resummarise` is set.

---

## Import / DI

```ts
import { createSummariseService } from '@features/summarise';

const svc = createSummariseService(database?);
```

- `database?`: optional `Database` from `bun:sqlite`.
- Defaults to `withDB()` if omitted.

---

## Public API

```ts
type SummariseService = {
  selectRepos: (sel: BatchSelector) => RepoRow[];
  saveSummary: (repoId: number, summary: string) => void;
};
```

### Types

```ts
type BatchSelector = {
  limit?: number; // default 10, coerced >= 1
  slug?: string; // restrict to one list (via list.slug)
  resummarise?: boolean; // include repos that already have summaries
};

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
```

---

## Behaviour & Queries

### `selectRepos(sel: BatchSelector)`

- **Global mode** (`sel.slug` unset):

  ```sql
  SELECT ... FROM repo
  WHERE summary IS NULL          -- unless resummarise
  ORDER BY (readme_md IS NULL) ASC,
           popularity DESC NULLS LAST,
           freshness DESC NULLS LAST
  LIMIT ?
  ```

  - Prioritises repos with a README (`readme_md IS NOT NULL`) first.
  - Falls back to popularity/freshness ordering.

- **List mode** (`sel.slug` provided):

  ```sql
  SELECT ... FROM repo r
  JOIN list_repo lr ON lr.repo_id = r.id
  JOIN list l       ON l.id = lr.list_id
  WHERE r.summary IS NULL AND l.slug = ?   -- unless resummarise
  ORDER BY r.popularity DESC NULLS LAST,
           r.freshness DESC NULLS LAST
  LIMIT ?
  ```

- **Limit**: coerced to ≥1 (default 10).

- Returns `RepoRow[]` for downstream summarisation.

---

### `saveSummary(repoId: number, summary: string)`

- Updates a single repo row:

  ```sql
  UPDATE repo SET summary = ? WHERE id = ?
  ```

- Used after an LLM has generated a new summary.
- Overwrites existing summaries (no merge).

---

## Programmatic Usage

### Select repos needing summaries

```ts
const svc = createSummariseService();

const batch = svc.selectRepos({ limit: 50 });
// → feed to Ollama for summarisation
```

### Save summaries back

```ts
for (const repo of batch) {
  const generated = await runLLM(repo); // external call
  svc.saveSummary(repo.id, generated);
}
```

### Force resummarise

```ts
const all = svc.selectRepos({ slug: "ai-machine-learning", resummarise: true });
// re-run summaries even if already present
```

---

## Notes

- **Scope**: DB service only. It does not call Ollama or generate text itself.
- **Prioritisation**: repos with README text come first in the default order, since summaries will be higher quality.
- **Idempotent**: Re-running with `resummarise` is safe; otherwise, existing summaries are skipped.
- **Consistency**: Summaries are short, neutral paragraphs — consistent style is maintained by the upstream prompt.
