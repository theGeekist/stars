<div align="center">
  <img src="logo.jpg" alt="Geekist Stars Logo" width="600" />
  <h1>Geekist Stars</h1>
  <p>A local, auditable toolset for GitHub Stars, Lists and collection discovery</p>
  <p>
    <a href="https://app.codecov.io/gh/theGeekist/stars"><img alt="Coverage" src="https://codecov.io/gh/theGeekist/stars/branch/main/graph/badge.svg" /></a>
    <a href="https://sonarcloud.io/summary/new_code?id=theGeekist_stars"><img alt="Quality Gate Status" src="https://sonarcloud.io/api/project_badges/measure?project=theGeekist_stars&amp;metric=alert_status" /></a>
    <a href="USAGE.md"><img alt="Usage documentation" src="https://img.shields.io/badge/docs-usage-blue" /></a>
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Ready-blue.svg" />
    <img alt="Bun 1.1 or later" src="https://img.shields.io/badge/bun-%E2%89%A51.1-ff69b4.svg" />
  </p>
</div>

Stars collects your GitHub Stars and Lists into SQLite, computes repository signals, prepares summaries, and scores repositories against your list criteria. The current checkout also includes collection discovery: it extracts resource mentions from repository READMEs, preserves their source context and makes them available for independent research.

Your directly curated Stars and Lists, a collection's mention of a resource, a repository summary and a research result are separate records. A resource mentioned in a README does not become a member of one of your GitHub Lists.

This README is the inventory of the implemented toolset. Read [the pipeline guide](docs/pipeline.md) for the stages in plain English and worked examples. [USAGE.md](USAGE.md) contains additional command usage; the linked feature guides and source files below define the current boundaries.

## Getting started

This is a private Bun and TypeScript package. The checkout declares Bun 1.1 or later and contains the `gks` executable entry point. From this checkout you can invoke the same commands with `bun start`.

```sh
bun install
bun run build
bun start help
```

Set configuration in your shell or a local `.env` file, which Bun loads. Keep credentials out of committed files.

| Setting                           | Used for                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`                    | Reading GitHub Stars and Lists; applying ranking changes; fetching discovery sources and resolving GitHub targets. The discovery script also accepts `GH_TOKEN` as a fallback. |
| `DB_FILE`                         | SQLite file; defaults to `repolists.db` in the working directory outside tests. Set it before starting the process.                                                            |
| `EXPORTS_DIR`                     | Export directory used by the main CLI; defaults to `./exports`.                                                                                                                |
| `OLLAMA_MODEL`                    | Model used by the default summary, scoring and setup generation paths.                                                                                                         |
| `OLLAMA_ENDPOINT` / `OLLAMA_HOST` | Endpoint settings used by model adapters; exact precedence depends on the API. See [summaries](src/api/summarise.public.ts) and [ranking](src/api/ranking.public.ts).          |
| `GH_EXPLORE_PATH`                 | Local `github/explore` checkout used to look up topic metadata.                                                                                                                |
| `TOPIC_TTL_DAYS`                  | Topic metadata refresh interval; defaults to 30 days.                                                                                                                          |

The shared [database module](src/lib/db.ts) opens its default SQLite connection when imported. A caller injecting its own database should set `DB_FILE=:memory:` before loading the library if it also needs to isolate that default connection. The discovery and research commands do this themselves and require an explicit existing `--db` path.

The package currently declares `@jasonnathan/llm-core` and `ollama` as dependencies and peer dependencies. The build externalises them, so the emitted JavaScript still needs these packages at runtime. The default model paths use Ollama; programmatic callers can inject generation or scoring implementations.

## Commands available now

The command router is [src/cli.ts](src/cli.ts). These are the implemented main CLI commands; discovery and research are separate scripts rather than `gks` subcommands. The `lists`, `stars` and `unlisted` handlers always supply an export directory, so their core functions' `--json`/`--out` alternatives are not reached through the current router.

| Command                                | What it does                                                                          | Main inputs and effects                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun start lists`                      | Fetches GitHub Lists and their repository metadata.                                   | Reads GitHub and writes the list index and per-list JSON exports to `EXPORTS_DIR`.                                                                                                    |
| `bun start repos --list "List name"`   | Fetches the repositories in one named GitHub List.                                    | Reads GitHub; displays results or prints JSON with `--json`.                                                                                                                          |
| `bun start stars`                      | Fetches all starred repositories with pagination.                                     | Reads GitHub and writes page files and a Stars index to `EXPORTS_DIR`; use a directory separate from List exports.                                                                    |
| `bun start unlisted`                   | Computes starred repositories absent from locally ingested List membership.           | Reads GitHub and local membership; writes `unlisted.json` to `EXPORTS_DIR`. Local List state therefore affects the result.                                                            |
| `bun start ingest`                     | Imports the existing list and unlisted exports into SQLite.                           | Reads `EXPORTS_DIR`; upserts repositories and Lists, computes signals and may reconcile removals for a complete export. It does not invoke a model.                                   |
| `bun start setup`                      | Generates `prompts.yaml` from GitHub Lists and the internal template.                 | Reads GitHub and writes configuration. It attempts criteria generation when Ollama is ready and otherwise leaves placeholders to edit.                                                |
| `bun start summarise --all --limit 20` | Generates repository summaries. `summarize` is an alias.                              | Selects repositories without summaries by default; `--resummarise` includes existing summaries. `--one owner/repo` targets one repository.                                            |
| `bun start score --all --limit 20`     | Scores summarised repositories against configured List criteria and plans membership. | Apply mode is the default: it can persist scores and change GitHub List membership. `--one owner/repo`, `--dry` and `--curation-threshold` are supported.                             |
| `bun start topics:enrich`              | Reconciles repository topics and fills topic metadata, aliases and related topics.    | Reads repository topics from SQLite and metadata from the local Explore checkout; writes topic tables. `--active` selects non-archived repositories; `--ttl N` overrides refresh age. |
| `bun start help`                       | Prints the main usage banner.                                                         | The banner is general help; the router does not implement separate help pages for each command.                                                                                       |

Examples that preview model-backed work:

```sh
bun start summarise --one facebook/react --dry
bun start score --one facebook/react --dry
```

`--dry` prevents the final summary save or ranking application. It does not mean that the whole process is free of local writes: summary preparation can fetch and cache a README. The summary and score CLI handlers also check that prompts configuration is ready.

The `stars` command writes an `index.json` object for paginated Stars; `lists` writes an `index.json` array of Lists. They are different formats and overwrite the same filename if pointed at the same directory. Ingest and discovery expect the List index plus `unlisted.json`, not the paginated Stars index.

A complete export is a data-authority decision, not merely a pair of present files. Validate that the fetch produced the whole current curation snapshot before ingesting it. Partial file imports and the public in-memory import do not prune absent repositories. Complete export cleanup retains repository overrides and discovered research; it removes ordinary absent repositories and reconciles absent direct memberships according to those protections. See [ingestion](src/features/ingest/README.md) and the [cleanup implementation](src/features/ingest/service.ts).

## Collection discovery added in this checkout

The [discovery command](scripts/discover.ts) reads `index.json`, every listed export file and `unlisted.json`. It deduplicates the directly exported repositories by their GitHub IDs and inspects each one's README at a pinned commit. This currently scans all directly exported repositories; it does not first classify which ones are collection repositories.

```sh
bun run scripts/discover.ts \
  --db /absolute/path/to/repolists.db \
  --exports /absolute/path/to/complete-current-exports
```

The command requires GitHub credentials and an existing database. It reports source and target-resolution failures, returns a non-zero exit status when failures remain, and can be repeated to retry. No schedule or orchestrator stage is installed by this command.

The discovery implementation currently provides:

- Markdown list and GFM table extraction, including reference links, source lines, heading sections, table columns and row context.
- Separate roles for author links and item links. Author URLs remain in row context; ambiguous non-author links remain eligible as unverified targets.
- Stable GitHub repository identity resolution through the existing GraphQL mapper and ingestion service. Files and subdirectories remain separate research targets while their parent repository is stored once.
- URL identities for external resources, including non-software resources.
- Historical source observations in `recovery_provenance.details_json`, current relationships in `discovery_edge`, target state in `discovery_target` and retained successful research results in `discovery_research`.
- Work selection independent of `repo.summary`, with current source observations attached to each work item. A research consumer can process items, retain results and retry individual failures. The supplied `createFetchConsumer` fetches bounded target evidence through an existing external safe-fetch command.
- Reconciliation of changed or removed sources without discarding previous research. Targets with no current source remain stored but are not selected for new work.

The [discovery guide](src/features/discovery/README.md) explains the exact states and source-removal policy. Discovery does not enumerate a repository's recipe or data archive, parse Cooklang files, or generate a finished research report. These operations are not wired into the main CLI, HTTP task runner, dispatcher or sequential orchestrator.

### Fetching independent target evidence

The [research command](scripts/research.ts) runs the current work list with [createFetchConsumer](src/features/discovery/consumer.ts):

```sh
bun run scripts/research.ts \
  --db /absolute/path/to/repolists.db \
  --fetcher /absolute/path/to/existing/safe_fetch.py
```

`--fetcher` points to an existing external Python safe-fetch implementation; that script is not bundled into Stars. The command requires the database and fetcher paths to exist. It processes all currently selected work, prints processed/done/retry counts and returns a non-zero status if any item remains retryable. It closes its database on success and failure.

The supplied consumer invokes `python3` by default, allows up to 200,000 response bytes and has a 60-second child-process timeout. Programmatic options can override the Python executable, byte bound (up to 5,000,000) and timeout. Each fetch uses a temporary directory that is removed on success or failure. The consumer checks the external fetcher's receipt against the downloaded bytes, then retains the requested and returned URLs, observation time, content type, byte count, SHA-256 hash and text for textual content. It marks source content as untrusted. The service stores successful results in the research history; failed items remain retryable.

A fetched response is evidence of what a source returned. This consumer does not verify the page's claims, perform model synthesis or produce a finished report. This section describes the implementation; it does not establish that a live research run has succeeded.

## Existing parsing and processing tools

These components already serve different parts of the toolset. Their outputs are not interchangeable.

| Tool                                              | Existing use and output                                                                                                                                                   | Source                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@jasonnathan/llm-core` Markdown splitter         | Uses Remark and GFM to split Markdown into text chunks for summary preparation. The splitter returns strings rather than an exposed link/table AST with source positions. | [README preparation](src/lib/readme.ts), [package manifest](package.json)                                         |
| Remark, `remark-parse`, `remark-gfm`, `unified`   | Parse Markdown and GFM tables. Discovery adds a collection-specific AST walker for link roles and source attribution; it uses these existing libraries.                   | [discovery extraction](src/features/discovery/parser.ts)                                                          |
| README fetch/cache helpers                        | Fetch GitHub READMEs, retain ETags and fetch times, clean text, chunk it and select informative chunks. Cached text can be reused after fetch failures.                   | [readme.ts](src/lib/readme.ts)                                                                                    |
| Awesome List detection and summary path           | Recognise likely directory repositories and produce a generic collection summary; this path does not itself extract and resolve each entry.                               | [utilities](src/lib/utils.ts), [summary generation](src/features/summarise/llm.ts)                                |
| GitHub GraphQL/REST transport and mappers         | Fetch repository/List data, handle pagination and retries where implemented, and map GitHub fields to `RepoInfo`.                                                         | [transport](src/lib/github.ts), [mapper](src/lib/mapper.ts), [Lists](src/lib/lists.ts), [Stars](src/lib/stars.ts) |
| SQLite schema, migrations and prepared statements | Persist the catalogue, relationships, overrides, summaries, scores, topic metadata and source evidence. SQLite FTS supports repository search.                            | [schema](sql/schema.sql), [database helpers](src/lib/db.ts)                                                       |
| YAML prompt configuration                         | Stores summary prompts, scoring criteria and thresholds; setup can generate its initial content.                                                                          | [prompt loading](src/lib/prompts.ts), [setup](src/features/setup/README.md)                                       |
| Ollama adapters and injectable model dependencies | Supply generation and embeddings for summaries and list scoring. Programmatic overrides can replace selected model operations.                                            | [summary API](src/api/summarise.public.ts), [ranking API](src/api/ranking.public.ts)                              |

There is no `@wpkernel/pipeline` dependency in this checkout. The orchestration remains the existing Bun runner and service/API boundaries.

## Library APIs

The root module [src/index.ts](src/index.ts) exports the following namespaces. Services beneath `src/features` provide lower-level database and GitHub operations, including List mutation helpers, but they are not all exported as root package namespaces.

| Root export       | Available operations                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `starsData`       | `fetchLists`, `fetchReposFromList`, `fetchStars`, `fetchUnlistedStars`. The first three return fetched data; unlisted selection also needs local List membership.                                                                             |
| `ingest`          | `ingestAll` imports exports despite its remote-oriented API comment; `ingestListsOnly` and `ingestUnlistedOnly` fetch GitHub data directly; `ingestFromMemory` imports supplied data without pruning. Also exposes `createProvenanceService`. |
| `summaries`       | `summariseAll` and `summariseRepo`, with injected database, generation dependencies, model configuration and batch progress where supported.                                                                                                  |
| `ranking`         | `rankAll`, `rankOne` and curation policy exports. Apply mode can persist scores and update GitHub List membership.                                                                                                                            |
| `setup`           | Prompt state and template updates, `.modelrc.json` reads/writes and model connectivity checks. Saving `.modelrc.json` does not itself select a model for every API.                                                                           |
| `discovery`       | `backfillCollections`, `createDiscoveryService`, `githubDiscovery` and `createFetchConsumer`, with their input types. `work()` selects current targets; `research(consumer)` runs a consumer with item-level outcomes.                        |
| `dispatchCommand` | Typed dispatch for summaries, ranking, Stars/List reads and ingest operations. Discovery, topics and setup do not currently have dispatcher keys.                                                                                             |

For example, inspect one repository without applying ranking changes:

```ts
import { ranking } from "@geekist/stars";

const result = await ranking.rankOne({
  selector: "facebook/react",
  dry: true,
});
console.log(result);
```

Summaries prefer explicit `deps` over `modelConfig`, then use environment defaults. Ranking prefers an explicit `llm` over `modelConfig`, then environment defaults. An injected implementation may send content to a remote provider; privacy depends on the selected consumer, model and endpoint.

## Local web interface and HTTP API

`bun run dev` starts [src/server.ts](src/server.ts) on port 8788 by default and serves the assets in `public`; set `STARS_API_PORT` to override the port. `bun run serve` runs the same server in watch mode. In the Geekist environment, external access goes through the common MCP bridge and Cloudflare deployment boundary; the local HTTP service supplies the API routes.

| Route                                  | Purpose                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/health`                              | Returns health status.                                                                                                                                                                                                                                                         |
| `/dashboard`                           | Returns export counts and SQLite counts for Lists, repositories, summaries and scores.                                                                                                                                                                                         |
| `/lists`, `/list/:slug`                | Read Lists and repositories assigned to a List.                                                                                                                                                                                                                                |
| `/search?q=...`                        | Searches repository FTS, with a name/description fallback if the FTS query fails; results are capped at 100.                                                                                                                                                                   |
| `/research/overview`                   | Reports catalogue size, enrichment coverage, latest score run, topic coverage and stored discovery/provenance counts.                                                                                                                                                          |
| `/research/repositories`               | Paginated research search. Supports `q`, `list`, `topic`, `language`, `minStars`, `minScore`, `archived`, `fork`, `hasSummary`, `hasReadme`, `sort`, `limit`, `offset`, and `includeReadme=true`. Results include List memberships and latest per-List scores with rationales. |
| `/research/repository?key=...`         | Returns a repository profile by `owner/name`, GitHub node ID or database ID: stored metadata, memberships, enriched topics, score history, curated overrides, collection observations and research results. Use `includeReadme=true` to return the full README text.           |
| `/research/repository/:owner/:repo`    | Path form of the repository profile lookup.                                                                                                                                                                                                                                    |
| `/research/topics?topic=...`           | Lists enriched topics or returns a topic profile with aliases, related topics and associated repositories.                                                                                                                                                                     |
| `/research/discoveries`                | Pages through stored discovery targets, current source observations and fetched research results. Supports `status`, `repo_node_id`, `source`, `limit`, and `offset`.                                                                                                          |
| `/logs`                                | Streams task logs using server-sent events.                                                                                                                                                                                                                                    |
| `POST /run/:task`                      | Starts `lists`, `ingest`, `summarise`, `score` or `topics:enrich`. Only one in-process task runs at a time.                                                                                                                                                                    |
| `/run/status`, `POST /run/cancel/:pid` | Report running tasks or request cancellation. Cancellation is cooperative and depends on the task passing the abort signal through.                                                                                                                                            |

The server's `ingest` task fetches GitHub Lists and unlisted Stars directly, unlike the main CLI's export-based `ingest`. Server summaries and scoring run in apply mode. Research endpoints expose discovery records already stored in SQLite; they do not backfill collections or fetch new sources. Discovery execution remains a separate CLI/consumer workflow.

Example research calls:

```text
GET /research/repositories?q=workflow&topic=automation&minStars=500&sort=stars&limit=20
GET /research/repository?key=owner/repository&includeReadme=true
GET /research/topics?topic=agents
GET /research/discoveries?status=done&source=https%3A%2F%2Fgithub.com%2Fowner%2Fcollection
```

## Sequential runner and development tools

[scripts/orchestrator.ts](scripts/orchestrator.ts) runs these stages in order: `lists`, `unlisted`, `ingest`, `git-pull`, `topics-enrich`, `summarise`, `score`. It supports `--only=...` and `--skip=...`, writes per-step logs under `logs/steps`, reports non-zero step exits in those logs, and implements no retries or timeouts. The non-zero-exit branch ends a log sink rather than explicitly throwing, so do not rely on fail-fast behaviour without verifying it. Its `git-pull` target is currently a hard-coded macOS Explore path that must be checked before using that stage on another host. It is a runner, not an installed schedule; discovery and research are not among its stages.

The package also provides build/declaration generation, TypeScript checking, Biome lint/format commands, Bun tests with configured coverage, coverage reporting and a Codecov diagnostic script. See [package.json](package.json), [build script](scripts/build.ts), [coverage report](scripts/coverage-report.ts) and [test configuration](bunfig.toml).

Before committing, the repository's [AGENTS.md](AGENTS.md) requires:

```sh
CI=1 bun run build
CI=1 bun lint --fix
CI=1 bun test
```

## Stored signals and limits

Repository signals are deterministic heuristics in [metrics.ts](src/lib/metrics.ts): popularity combines log-scaled Stars, forks and watchers; freshness uses the selected repository timestamp; activeness blends open issue/PR counts and push freshness with penalties for archived repositories or disabled issues. They are useful sorting signals, not measurements of project quality or verified maintenance health.

Summaries are generated interpretations of available repository material. Ranking depends on your List criteria and curation policy. Topic metadata depends on the local Explore data. Collection extraction establishes that a source mentioned a target; independent research is still needed to verify claims about that target. The checkout contains neither a general fact-checker nor an automatic publishing stage.

## Feature documentation

- [Pipeline stages and examples](docs/pipeline.md)
- [Command usage](USAGE.md)
- [Stars exports](src/features/stars/README.md)
- [Ingestion and cleanup](src/features/ingest/README.md)
- [Collection discovery and research work](src/features/discovery/README.md)
- [Summaries](src/features/summarise/README.md)
- [Scoring and curation policy](src/features/scoring/README.md)
- [Lists services](src/features/lists/README.md)
- [Topics](src/features/topics/README.md)

## Citation

```bibtex
@software{nathan_geekist_stars_2025,
  author = {Jason Joseph Nathan},
  title = {Geekist Stars},
  year = {2025},
  publisher = {GitHub},
  journal = {GitHub repository},
  howpublished = {\url{https://github.com/theGeekist/stars}},
}
```
