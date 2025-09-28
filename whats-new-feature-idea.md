## Problem Statement

You want a repeatable way to identify **where “What’s new” lives for any given GitHub repo**. The challenge isn’t summarising or presenting updates yet — it’s consistently finding the _surface of truth_: Releases, Changelogs, Discussions, README sections, or commit streams.

These locations are fairly stable once a repo adopts a pattern, but they differ project by project. Today, you don’t want to reinvent the wheel deciding which signals to trust — you want to **leverage existing conventions, API endpoints, and community heuristics** (Keep-a-Changelog, semantic-release, Conventional Commits, etc.) to build a compact “map” per repo of where updates reside.

That map becomes a flat metadata entry for GitHub stars, powering a daily crawl later. In other words: the real problem is _signal discovery and normalisation_ across diverse repos.

---

## Potential Solutions

### 1. **Signals to Detect**

- **GitHub Releases** (API + Atom feed) — most popular and structured.
- **CHANGELOG / CHANGES / HISTORY / NEWS files** — especially if following Keep-a-Changelog style.
- **README headings** — fallback sections like “What’s new” or “Release notes.”
- **GitHub Discussions → Announcements** — some projects centralise updates there.
- **Conventional Commit streams** — last resort when no other source exists.
- **semantic-release footprint** — indicates generated release notes or maintained changelog.

Each repo usually sticks with one or two of these long-term.

---

### 2. **How to Capture This**

- **Ranked heuristics**: probe in order (Releases → Changelog → Discussions → README → Commits).
- **Flat metadata per repo**: store the chosen “where to look” source(s) as JSON alongside repo data in GitHub stars.
- **Daily crawl**: use this pointer to fetch new content without re-guessing.

---

### 3. **Why This Matters for GitHub stars**

- Provides _consistency_: every repo has a known “update surface.”
- Reduces noise: you don’t scrape whole repos every time, only the chosen sources.
- Keeps costs down: local models can summarise update notes once the correct signal is located.
- Positions GitHub stars as not just a list, but an **up-to-date lens** on the repos you curate.

---

## GitHub Fetch Touchpoints (Lists & Unlisted)

We already source repository snapshots through two primary commands:

- **`gks lists`** → `@lib/lists.getAllLists{,Stream}` (GraphQL `viewer.lists` → `LIST_ITEMS_AT_EDGE`).
- **`gks unlisted`** → `features/stars` service, ultimately calling `@lib/stars.getAllStars{,Stream}` (GraphQL `viewer.starredRepositories`).

Both converge on the shared `RepoInfo` shape before ingestion; however, “What’s new” requires us to enrich that payload so we can decide, per repo, which update surface to trust without another pass over GitHub.

### Proposed Augmentations (Single Round Trip)

| Signal           | Lists Query Addition                                                                                                                                   | Stars Query Addition | Stored As                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------- |
| Latest release   | `releases(first: 1) { nodes { tagName publishedAt url } }`                                                                                             | Same fragment        | `RepoInfo.lastRelease` (replace `null`)              |
| Changelog files  | `object(expression: "HEAD:CHANGELOG.md") { ... on Blob { byteSize text(limit: 2048) } }` plus fallbacks (`docs/CHANGELOG.md`, `NEWS.md`, `HISTORY.md`) | Same fragment        | JSON array `{ path, size, excerptHash }`             |
| Announcements    | `hasDiscussionsEnabled`, `discussionCategories(first: 5) { id name }`                                                                                  | Same fragment        | Flags inside `updates_json`                          |
| Automation hints | `usesSemanticCommitMessages`, `isSecurityPolicyEnabled`                                                                                                | Same fragment        | Booleans used to rank commit fallback                |
| Commit preview   | Extend `defaultBranchRef` with `history(first: 5) { nodes { messageHeadline committedDate } }`                                                         | Same fragment        | Stored only when no higher-confidence surface exists |

> All additional fields live in the same GraphQL request; payload size stays manageable because we cap text blobs and avoid downloading full changelog bodies.

### Data Mapping & Storage

1. Extend `RepoInfo` (and corresponding TypeScript types) to carry `updateCandidates` describing release/changelog/discussion hints. Populate the existing `lastRelease` field with real data instead of `null`.
2. Add a nullable `updates_json TEXT` column to the existing `repo` table (lightweight migration). Store a compact payload such as `{ "preferred": "release", "candidates": [...], "lastChecked": "ISO" }`.
3. During ingest/unlisted import, persist the JSON alongside other repo columns. Rank candidates deterministically (release > changelog > discussion > commit) and retain alternates in the same blob for fallback logic.

### Shared Fetch Utilities

To prevent divergence between `lists` and `stars` collection:

1. Create a shared GraphQL fragment (e.g., `RepoWithUpdates`) and reuse it in both `LIST_ITEMS_AT_EDGE` and `VIEWER_STARS_PAGE` queries.
2. Replace `mapRepoNodeToRepoInfo` and `mapStarEdgeToRepoInfo` with a single `mapRepoNodeWithUpdates` helper in a new module (`src/lib/repo-mapper.ts`), parameterised only for context-specific fields (e.g., `starredAt`).
3. Update tests in `src/lib/lists.test.ts` and `src/lib/stars.test.ts` to assert the new update metadata is present and consistent across both flows.

### Refactor Checklist

1. **GraphQL**: add the shared fragment and adjust both queries.
2. **Types**: extend `RepoInfo`, add `UpdateCandidate` interfaces, and regenerate affected type guards.
3. **Mapper**: centralise repo mapping logic and delete duplicated code.
4. **Ingestion**: write the `updates_json` blob (and updated `lastRelease`) during ingest so both lists and unlisted flows cache the same data.
5. **Fixture updates**: refresh mocked GitHub responses and ensure existing tests cover the new priority ordering.

### Path Toward the “What’s New” Pipeline

1. **Detect**: read `repo.updates_json`, surface repos without high-confidence sources for manual review.
2. **Crawl**: fetch latest updates from the stored surface (release notes, changelog diff, discussion post) and persist raw payloads in a `repo_updates` or equivalent history table when we introduce time-series storage.
3. **Summarise**: hand those payloads to the summarisation service to generate 60–90 word blurbs ready for CLI/dashboard display.
4. **Automate**: schedule the end-to-end task (`gks whatsnew --all`) inside `scripts/orchestrator.ts`, and expose counts/status in the server dashboard alongside summaries and scores.

By enriching the existing GitHub collection and unifying the mapping logic, we keep requests consolidated, eliminate duplication between `lists` and `unlisted`, and lay a solid foundation for the “What’s new” feature to behave like the existing summarise/score pipelines.
