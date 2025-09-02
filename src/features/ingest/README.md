# Ingest Feature

Imports GitHub Lists and repositories into SQLite, computes lightweight metrics (popularity, freshness, activeness), and normalises topics.

## Public API

- Default export `ingest(dir?: string): Promise<void>` from `@src/ingest` – reads exports from a directory (defaults to `EXPORTS_DIR` or `./exports`) and upserts into `list`, `repo`, and `list_repo`.

## Usage (programmatic)

```ts
import ingest from "@src/ingest";
await ingest(process.env.EXPORTS_DIR ?? "./exports");
```

## CLI

- `gk-stars ingest [--dir <folder>]`

Environment:

- `GITHUB_TOKEN` – used by upstream utilities when fetching from the API (not required for local exports).

