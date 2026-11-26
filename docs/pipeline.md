# How the Stars pipelines work

Stars turns your GitHub stars and Lists into a local catalogue, then offers separate ways to enrich, research and organise that catalogue. A stage can be run on its own; the repository's sequential runner calls several stages in order. Discovery and its evidence consumer are currently **separate commands**: they are not wired into the runner or a timer.

This guide describes the code in this checkout. It does not claim a live run succeeded or describe the current state of a host service. For exact commands and dependencies see the [toolset README](../README.md); for the new workflow see [collection discovery](../src/features/discovery/README.md). The host's operational workflow is separate from the repository's example runner.

## The route from GitHub to the catalogue

```text
GitHub stars and Lists
  -> export JSON -> ingest -> SQLite catalogue
                               |-> topic enrichment
                               |-> repository summaries -> scoring and List plans
                               |-> collection discovery -> evidence work queue -> fetch consumer
```

A _repository_ is a GitHub project. A _GitHub List_ is a group the account owner curates on GitHub. The local catalogue is a SQLite database: it holds repository records, list relationships, topics, summaries and other local state. A collection README may mention a target without the account owner having starred it or added it to a GitHub List. Stars keeps those relationships distinct.

### 1. Export the directly curated material

The `lists` command fetches GitHub Lists and their repositories into `index.json` and per-list JSON files. `unlisted` fetches stars that are not in Lists. Together, those files describe the input for a complete file-based catalogue import. A successful fetch and a complete, current snapshot must be established separately: the mere presence of files does not prove either.

The `stars` command also exports stars, but writes a different `index.json` shape. Use a separate export directory for it; do not overwrite the List index needed by ingest. GitHub requests use the configured authenticated account. See [the CLI handlers](../src/cli.ts) and [export implementation](../src/api/stars.ts).

### 2. Ingest and reconcile

`ingest` reads the export directory and stores repositories and List links in SQLite. It imports unlisted repositories first, then List repositories; later List data wins where fields differ. Repository identity is matched by GitHub node ID where available, with names used as a fallback. Ingest also derives popularity, freshness, activeness and tags from the input metadata. These are calculated signals, not a judgement of whether an item deserves research.

A file import with both an index and unlisted file invokes cleanup for absent exported repositories. Partial imports and normal in-memory imports do not. Existing manual overrides protect a repository. A repository previously recorded as discovered is retained even after its last collection source disappears; absent direct List links are removed unless an override protects them. Never-discovered, unprotected repositories still follow normal cleanup. See [ingest service](../src/features/ingest/service.ts) and [discovery retention](../src/features/discovery/README.md).

For example, if a cookbook is directly in a List and is also mentioned by a collection, its repository row is shared. A collection mention does not create another GitHub List link. If it later disappears from a complete direct export, discovery can retain its repository and research; its unprotected direct List links are reconciled separately.

### 3. Enrich topics

`topics:enrich` builds repository topic references, reconciles the local repo-to-topic mapping, and refreshes stale topic descriptions, aliases and related topics. The topic metadata comes from a local `github/explore` checkout specified by `GH_EXPLORE_PATH`. The `--active` option limits selection if explicitly used; discovery itself does not add an age or activity filter. The normal topic metadata age setting defaults to 30 days. Topic associations are distinct from a collection's context topics. See [topics](../src/features/topics/README.md).

For example, the topic on a cookbook repository and the topic on the collection which mentioned it are separate observations. A collection's context does not silently become the cookbook's own GitHub topic.

### 4. Summarise repositories

`summarise` selects repository rows, normally those with `summary IS NULL`, and creates a short paragraph from available metadata and README material. It can use a local model; the Awesome List path has a deterministic summary shortcut. The summary is saved to the repository row unless `--dry` is used. A caller can explicitly request resummarisation. Individual batch failures are reported while later rows continue. See [summarisation](../src/features/summarise/README.md) and [its public API](../src/api/summarise.public.ts).

A repository with an existing summary is ordinarily skipped. A new collection mention nevertheless creates discovery work independently; it does not overwrite the existing summary or mean independent research has already occurred.

### 5. Score and organise Lists

`score` evaluates repository information against configured List criteria and creates a plan with scores and rationales. **Without `--dry`, ranking can apply membership changes to GitHub and reconcile local membership.** The dry option is the way to preview instead. The scoring CLI parses `--resume` and `--fresh`, but the current handler does not pass them to `rankAll`; do not assume those flags resume that CLI batch. See [ranking API](../src/api/ranking.public.ts), [CLI handler](../src/cli.ts), and [scoring](../src/features/scoring/README.md).

For example, `gks score --one owner/project --dry` requests a preview for one repository. A score or model rationale is a suggestion based on its inputs, not independently verified evidence.

## Collection discovery and evidence

### 6. Extract mentions from a curated export

`scripts/discover.ts` takes an explicit existing database and a validated complete direct-curation export. For each exported repository it verifies the collection’s GitHub identity and requests a pinned README revision and walks Markdown lists and tables using Remark/GFM, the same parser family used by the existing Markdown splitter. It records a target URL, collection identity, commit, document path, line, section, row context, related links and source topics. An author column is preserved as context rather than promoted to a repository item. Other ambiguous links are leads, not verified entries. A file or subdirectory link remains its own target.

GitHub repository targets are resolved to stable node IDs and passed to existing ingestion; non-GitHub targets retain URL identities. This does not create List membership. Historical source observations live in `recovery_provenance`; current edges and work status are separate. Multiple collections can point to the same target. A source fetch failure retains its prior edges; a successful changed source replaces its current edges. An omitted source is reconciled against the supplied complete export. A target with no current source remains stored but is not offered for work.

A backfill is explicit, can make many GitHub requests, and is not part of the existing sequential runner:

```sh
GITHUB_TOKEN="$(gh auth token)" bun run scripts/discover.ts \
  --db /absolute/path/to/existing.db \
  --exports /absolute/path/to/verified-complete-exports
```

Inspect the exit status and failure report. A failed target resolution is retried by a later backfill; it is not offered as a successfully resolved research item. The command closes its database and uses an in-memory default singleton. See [the discovery guide](../src/features/discovery/README.md) for the full contract.

### 7. Fetch evidence for pending targets

The discovery service selects pending and retryable targets with current sources, including targets whose repository already has a summary. Each work item carries its current source observations. The connected fetch consumer invokes a supplied safe-fetch program and records the final URL, retrieval time, content type, byte count, SHA-256 and textual response where applicable. Temporary files are removed on success and failure. A failed item remains retryable; one failure does not stop later items. New or removed source relationships can requeue work, and previous research results are retained with the source context used. If sources change during a fetch, that result is retained as history and the updated work stays pending.

For the existing Geekist safe-fetch tool, an explicit invocation is:

```sh
bun run scripts/research.ts \
  --db /absolute/path/to/existing.db \
  --fetcher /absolute/path/to/geekist-admin/scripts/stars/safe-fetch.py
```

The consumer captures **source material**, not verified facts, an LLM synthesis or a publication-ready report. The current safe fetcher accepts public HTTPS destinations and enforces bounded responses; unsupported, inaccessible or oversized targets remain retryable. Its path is supplied by the caller so a portable deployment can provide an equivalent compatible fetcher. A retry can make another network request. Idempotent storage does not remove a dependency between discovery, resolution and evidence fetching, nor does it make network requests or downstream publishing side effects disappear.

For example, a collection row may name a cookbook repository, a separate author and an external recipe site. The repository and site can become independent work items, each with the original row attached as context. The author link remains row context. Fetching the recipe site records what that site returned; it does not verify nutrition, authorship or reuse rights.

## Running stages together

The checkout's [sequential runner](../scripts/orchestrator.ts) lists `lists`, `unlisted`, `ingest`, `git-pull`, `topics-enrich`, `summarise` and `score` in that order. Its `--only` and `--skip` filters select steps and it writes step logs. Its `git-pull` path is a hard-coded developer-machine path, so inspect configuration before relying on it on another host. Its non-zero handling ends a log sink rather than explicitly throwing; check each step's exit and logs rather than assuming later steps cannot run after a failure. It does not call discovery or the new evidence consumer.

Lumos enrichment and Neo4j association are described separately in [Associating Stars discoveries with Lumos and Neo4j](lumos-association.md). That handoff is not yet implemented.

The WordPress catalogue, BI, drafts, static export and publication are separate host workflows. Writing a Stars SQLite row is not the same as publishing a page. This document makes no claim about any live service's current state or a public deployment.
