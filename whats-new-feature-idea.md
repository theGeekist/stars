## Problem Statement

We need a repeatable way to identify **where “What’s new” lives for each GitHub repo**. The goal is not summarisation yet, but consistently finding the _surface of truth_: Releases, Changelogs, Discussions, README sections, or commit streams.

These locations are stable once a repo adopts a pattern, but they differ project by project. Instead of reinventing heuristics, we can **leverage existing conventions and GitHub API signals** (Keep-a-Changelog, semantic-release, Conventional Commits, etc.) to build a compact “map” per repo. This map becomes a flat metadata entry, powering later crawls and summaries.

---

## Signals to Detect

- **GitHub Releases** — most common and structured.
- **CHANGELOG/CHANGES/HISTORY/NEWS** — especially Keep-a-Changelog style.
- **README headings** — fallback sections like “What’s new” / “Release notes.”
- **GitHub Discussions → Announcements** — used by some projects.
- **Conventional Commits** — last resort.
- **semantic-release footprint** — indicates auto-generated notes.

---

## Capture & Storage

- **Ranked heuristics**: Releases → Changelog → Discussions → README → Commits.
- **Single round trip**: enrich existing list/unlisted queries with release info, changelog blobs, discussion categories, and short commit history.
- **Flat metadata**: persist to `repo.updates_json` (additive, optional).

### `updates_json` schema (aligned with types)

```json
{
  "preferred": "release",
  "candidates": [
    { "type": "release", "confidence": 0.9, "data": { "tagName": "v1.2.3" } },
    {
      "type": "changelog",
      "confidence": 0.8,
      "data": { "path": "CHANGELOG.md" }
    }
  ],
  "lastChecked": "2025-09-28T00:00:00Z",
  "lastSeenVersion": "v1.2.3"
}
```

---

## Shared Fetch Utilities

- Shared **`RepoWithUpdates`** GraphQL fragment used by **lists** and **stars**.
- Centralised mapper **`mapRepoNodeWithUpdates`** feeds `RepoInfo.updates` and DB persistence.
- Tests/fixtures updated to assert parity across both flows.

---

## Path Toward the Pipeline

1. **Detect** (done during ingest): populate `updates_json`.
2. **Crawl**: follow the preferred pointer; store deltas with hash-based dedupe in a time-series table.
3. **Summarise**: generate 60–90 word blurbs from captured payloads.
4. **Automate**: `gks whatsnew --all`; show freshness/coverage on the dashboard.

---

## Status

**Completed**

- **Full integration**: shared fragment + unified mapper now hydrate watcher counts, latest release data, and **update candidates** for both CLI exports and public APIs.
- **Persistence**: `repo.updates_json` added; populated during ingest; exported JSON now includes updates metadata.
- **Refactor**: legacy `run*`/`summarise*` wrappers removed from core paths in favour of **core APIs**; CLI now routes via `run*Core`/`summarise.public`.
- **Compatibility**: deprecated wrappers remain exported (JSDoc `@deprecated`) and current CLI behaviour continues to honour `--json`, `--out`, and `EXPORTS_DIR` (`./exports` default).
- **Tests**: suites updated; typecheck clean; CLI handler tests migrated to new deps injection.

**Next Work**

- **Backfill**: run ingest (lists + unlisted) to populate `repo.updates_json` for existing DBs.
- **Surface**: API/UI to read and display `updates_json` (preferred source, coverage stats).
- **Time-series**: add `repo_updates` table (repo_id, source_type, version/anchor, raw_notes, content_hash, fetched_at).
- **Crawl + Summarise**: implement delta fetch, dedupe, then summary generation; expose via CLI/dashboard.
- **Wrappers decision**: confirm deprecation timeline or auto-select `./exports` when paths are omitted.

---

## Why This Matters

- **Consistency**: every repo has a trusted update surface.
- **Efficiency**: one GH round trip; no blind scrapes.
- **Cost control**: crawl only the chosen surface; summarise locally.
- **Value**: turns stars into an **up-to-date lens** on curated repos.
