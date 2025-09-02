# Summarise Feature

Generates concise, one‑paragraph summaries per repository using a local Ollama model. Combines README text (when available) with repo metadata and topics. Also exposes a DB‑backed selector and a summary saver.

## Public API

- `summariseRepoOneParagraph(meta: Meta, deps?): Promise<string>` – LLM‑driven paragraph (<=100 words). Uses README heuristics and optional embedding to pick informative chunks.
- `createSummariseService()` – returns `{ selectRepos(sel), saveSummary(id, summary) }`:
  - `selectRepos({ limit, slug?, resummarise? }): RepoRow[]` – choose batch by popularity/freshness; filter by list slug when provided; include already summarised when `resummarise` is true.
  - `saveSummary(repoId, summary)` – persist into `repo.summary`.

## Usage (programmatic)

```ts
import { summariseRepoOneParagraph, createSummariseService } from "@features/summarise";

const svc = createSummariseService();
const rows = svc.selectRepos({ limit: 5 });
for (const r of rows) {
  const text = await summariseRepoOneParagraph({
    nameWithOwner: r.name_with_owner,
    url: r.url,
    description: r.description ?? undefined,
    primaryLanguage: r.primary_language ?? undefined,
    topics: JSON.parse(r.topics ?? "[]"),
    metrics: { popularity: r.popularity, freshness: r.freshness, activeness: r.activeness },
    repoId: r.id,
  });
  svc.saveSummary(r.id, text);
}
```

## CLI

- `gk-stars summarise (--one <owner/repo> | --all [--limit N]) [--dry] [--resummarise]`

Environment:

- `OLLAMA_MODEL` – local model name (e.g. `llama3.1:8b`).

