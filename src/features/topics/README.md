# Topics Feature

Offline topic enrichment and repo–topic reconciliation backed by SQLite. Reads `repo.topics` JSON, normalises topics, maintains `repo_topics`, and refreshes canonical topic metadata (display name, descriptions, aliases, related) from a local clone of `github/explore`.

## Public API

- `normalizeTopics(topics: string[]): string[]` – lowercases, trims, hyphenates, dedupes.
- `repoTopicsMany(refs: RepoRef[], opts?): Map<string,string[]>` – DB‑only, reads `repo.topics` JSON for many repos.
- `topicMetaMany(topics: string[], opts?): Map<string,TopicMeta|null>` – file‑system only; parses `$GH_EXPLORE_PATH/topics/<slug>/index.md`.
- `upsertTopic(row: TopicRow): void` – insert/update canonical topic row.
- `upsertTopicAliases(topic: string, aliases?: string[]): void` – alias → canonical mapping.
- `upsertTopicRelated(topic: string, related?: string[]): void` – undirected related edges.
- `reconcileRepoTopics(repoId: number, topics: string[]): void` – exact mapping for a repo (adds/removes rows in `repo_topics`).
- `selectStaleTopics(universeJson: string, ttlDays: number): {topic:string}[]` – topics missing meta or beyond TTL.
- `createTopicsService()` – exposes `listRepoRefs(onlyActive?)` and `enrichAllRepoTopics({ onlyActive?, ttlDays? })`.

Types are exported from `./types`.

## Usage (programmatic)

```ts
import { createTopicsService } from "@features/topics";

// Refresh topics (active repos only) using GH_EXPLORE_PATH content
const svc = createTopicsService();
const res = svc.enrichAllRepoTopics({ onlyActive: true, ttlDays: 30 });
console.log(res); // { repos, unique_topics, refreshed }
```

## CLI

- `gk-stars topics:enrich [--active] [--ttl <days>]`
- `gk-stars topics:report [--missing] [--recent] [--json] [--full]`

Environment:

- `GH_EXPLORE_PATH` – path to local `github/explore` clone.

