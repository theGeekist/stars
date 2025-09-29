<div align="center">
  <img src="logo.jpg" alt="Geekist Stars Logo" width="600" />
  <h1>Geekist Stars</h1>

  <p>A Local, Auditable Pipeline for Curating your Starred GitHub Repositories</p>

  <p>      
    <a href="https://app.codecov.io/gh/theGeekist/stars">
      <img alt="Coverage" src="https://codecov.io/gh/theGeekist/stars/branch/main/graph/badge.svg" />
    </a>
    <a href="https://sonarcloud.io/summary/new_code?id=theGeekist_stars">
      <img alt="Quality Gate Status" src="https://sonarcloud.io/api/project_badges/measure?project=theGeekist_stars&metric=alert_status" />
    </a>
    <a href="USAGE.md">
      <img alt="Docs" src="https://img.shields.io/badge/docs-usage-blue" />
    </a>
    <img alt="License" src="https://img.shields.io/badge/License-MIT-green.svg" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Ready-blue.svg" />
    <img alt="Bun" src="https://img.shields.io/badge/bun-%E2%89%A51.0-ff69b4.svg" />
  </p>

</div>

## Quickstart

```bash
bun install && bun run build && gks setup
```

If you plan to use **summaries** or **ranking (categorise)** features you must also install local LLM peer packages (now externalised to keep bundles tiny):

```bash
bun add @jasonnathan/llm-core
```

Without those peers only the non-LLM features (lists, stars data export, ingest, topics) are usable.

## What it does

Geekist Stars provides a local pipeline that helps you organize, analyze, and curate your starred GitHub repositories and lists. Using local AI models, it can score and categorize repositories based on customizable criteria, providing explainable rationales for every decision. You can review, accept, or adjust these categorizations as needed. Learn more in the [Scoring documentation](src/features/scoring/README.md).

The tool generates concise, factual summaries for each repository by analyzing README files, metadata, and activity signals. These summaries are designed for quick recall and triage, making it easier to remember why you starred a project. Details are in the [Summarization documentation](src/features/summarise/README.md).

It manages your starred repositories by syncing with GitHub, efficiently handling thousands of stars, and providing ways to compare and reconcile local and remote data. You get access to rich metadata and can flexibly query and analyze your collection. See the [Stars Management guide](src/features/stars/README.md).

For ingestion, Geekist Stars imports and organizes your GitHub Lists and stars, keeping your local database synchronized and clean. It automatically removes repositories that are no longer starred (unless you specify overrides), and computes useful health metrics like popularity and activeness. Read more in the [Ingestion documentation](src/features/ingest/README.md).

The system enriches and normalizes repository topics by parsing local data from `github/explore`, ensuring topics are standardized, canonicalized, and mapped with relationships and aliases for deeper analysis. More on this in the [Topics documentation](src/features/topics/README.md).

Finally, it integrates with GitHub Lists, enabling bidirectional syncing, membership management, and batch operations for organizing repositories into meaningful groups. Conflicts are handled intelligently to preserve manual curation. Learn about this in the [Lists documentation](src/features/lists/README.md).

### What you get

**At a glance outputs (typical run):**

```
• Summary (60–90 words):
  react — A declarative UI library focusing on composition and unidirectional data flow…

• Plan (categorise):
  + add   react to “Frontend Frameworks” (score 0.92, rationale: virtual DOM, JSX)
  - remove lodash from “Frontend Frameworks” (score 0.07, rationale: utility library)
  ~ review htmx (score 0.58, borderline)

• Topics report:
  142 topics, 97% canonicalised, 38 aliases, 121 related edges
```

**Peek into the DB** (fully auditable):

```sql
-- Top 10 repos by activeness last 90 days
SELECT name_with_owner, activeness
FROM repo
ORDER BY activeness DESC
LIMIT 10;
```

## Abstract

Geekist Stars is a Bun and TypeScript toolkit for turning your GitHub Lists and starred repositories into an auditable, local-first corpus. It computes health signals, generates local summaries, provides explainable categorization, and enriches topics using offline metadata.

### Models (Mac quick-pick)

For 16 GB RAM, use `llama3.1:8b` for summaries and `qwen2.5:7b` or `llama3.1:8b` (slower) for ranking. With 32 GB+ RAM, use `qwen2.5:7b` for summaries and either `llama3.1:8b` or `qwen2.5:7b` for ranking. Prefer quantized models such as `:Q4_K_M` for speed, and set `OLLAMA_NUM_PARALLEL=1` to avoid system thrashing.

The CLI offers structured help, examples, and detailed flag descriptions. Use `--help` on any command for guidance.

See [USAGE.md](USAGE.md) for CLI usage and examples.

## Motivation

Developers often accumulate hundreds or thousands of starred repositories, making it difficult to recall their significance or organize them over time. Existing tools offer basic search and browsing, but rarely combine list curation, concise summaries, explainable categorization, and topic enrichment in a private and extensible way. Geekist Stars fills this gap with a local-first pipeline.

SaaS stars managers often fall short on privacy, auditability, and composability. Geekist Stars is private by default (no repo content leaves your machine), every decision is auditable in SQLite, and you can build your own reports with SQL.

## Problem Statement

Given a user's GitHub Lists and starred repositories, the goal is to build a local system that summarizes each repository for engineers, categorizes repositories for user-defined lists, enriches them with offline topic metadata, and stores everything in a relational database for reproducibility and auditing.

## Contributions

Geekist Stars uses local LLMs (via Ollama), an editable prompt schema, explainable categorization, robust summarization, offline topic enrichment, and auditable storage in SQLite.

## System Overview

The pipeline consists of four independent stages: ingest (imports and cleans up repositories and lists, computes metrics, normalizes topics), summarize (generates one-paragraph summaries), categorize (scores repositories for lists and proposes actions), and topics (enriches and normalizes topics from local data).

## Data Model (Summary)

Data is organized into lists and memberships, repositories and computed signals, repository overrides, a text index for search, model audit tables, topics and their relationships, and reconciled repo-to-topic mappings.

### Signals (glossary)

Popularity is based on log-scaled stars and forks (decays with age), freshness is based on recent commits, and activeness measures commit/issue/PR velocity normalized for repo size.

## Methods

Summarization produces factual, present-tense summaries of 60-90 words. Categorization uses structured prompts and explicit policies to propose list changes. Topic enrichment parses local `github/explore` data to provide metadata, aliases, and related topics.

## Reproducibility

Prompts are versioned in YAML and editable. Each categorization run is uniquely identified, with all scores stored. The database evolves via additive migrations and can be re-run to verify outputs. Progress is persisted for long runs, and commands support resuming.

## Current Scope and Non-Goals

Search is basic (SQLite FTS), and human review is expected for categorization. The system does not attempt to infer beyond prompts and metrics.

## Limitations

Summary quality depends on repository metadata. Categorization depends on clear list criteria. Topic coverage is limited to what's available in `github/explore`.

## Future Work

Planned improvements include advanced search, graph export, historical diffing, and assisted criteria authoring.

## Ethics and Privacy

All inference is local via Ollama. The database remains on disk and is fully inspectable and removable. No repo data, summaries, or scores are sent to third parties. List updates to GitHub require explicit user action.

## Conclusion

### Automation (nightly)

Schedule the orchestrator to run nightly (e.g., at 1 am), then review the results in the morning.

```bash
0 1 * * *  bun /path/to/stars/scripts/orchestrator.ts --only=lists,ingest,summarise,score >> /path/to/stars/logs/cron.out 2>&1
```

## Programmatic API

You can use Geekist Stars as a library in addition to the CLI. All batch and single operations use options objects, support progress hooks, and allow per-request model overrides.

```ts
import {
  summaries,
  ranking,
  starsData,
  ingest,
  dispatchCommand,
} from "@geekist/stars"; // install @jasonnathan/llm-core + ollama for summaries/ranking

// Summarise a batch with a temporary model override and progress
const summariesResult = await summaries.summariseAll({
  limit: 50,
  modelConfig: { model: "llama3:8b", host: "http://localhost:11434" },
  onProgress: (e) => {
    if (e.phase === "summarising") {
      console.log(`Summarising ${e.index}/${e.total}`);
    }
  },
});

// Rank a single repository, applying list membership
const ranked = await ranking.rankOne({
  selector: "facebook/react",
  dry: false,
  modelConfig: { model: "llama3:custom" },
});
if (ranked.status === "ok") {
  console.log(ranked.plannedLists, ranked.changed);
}

// Use curation mode to preserve manual list curation
const curatedRanking = await ranking.rankAll({
  limit: 100,
  dry: false,
  policy: ranking.DEFAULT_POLICY,
});

// Custom curation threshold
const customCuration = await ranking.rankOne({
  selector: "microsoft/vscode",
  dry: false,
  policy: {
    respectManualCuration: true,
    curationRemoveThreshold: 0.15,
  },
});

// Fetch lists & stars (pure data, throws ConfigError if token missing)
const lists = await starsData.fetchLists();
const stars = await starsData.fetchStars({
  onProgress: (e) => {
    if (e.phase === "stars:page") console.log("Fetched another page");
  },
});

// Ingest everything (lists + stars) into the DB
await ingest.ingestAll({ onProgress: (e) => console.log(e.phase) });

// Dynamic invocation via dispatcher
await dispatchCommand("summaries:all", { args: { limit: 10 } });
```

### Model Precedence

For summaries and ranking, explicit `deps`/`llm` objects are used if provided, then `modelConfig`, then environment variables as fallback.

### Progress Phases (Overview)

| Domain    | Phase       |
| --------- | ----------- |
| summaries | summarising |
| ranking   | ranking     |
| lists     | lists:fetch |
| stars     | stars:page  |
| ingest    | ingest:\*   |

### Error Handling

Missing configuration raises `ConfigError`. Ranking JSON parse issues are surfaced per item, but batches continue. See `MIGRATION.md` for details.

Geekist Stars demonstrates that local-first tooling can turn a noisy GitHub star collection into a structured, auditable, and navigable resource. By combining editable prompts, simple metrics, explainable categorization, and local topic enrichment, it helps you maintain control over your personal repository corpus.

## Bundle Size & Externals

The LLM stack (`@jasonnathan/llm-core`, `ollama`) is externalized to keep published bundles small:

```
index.js            ~225 KB
cli.js              ~231 KB
summarise.public.js ~174 KB
ranking.public.js   ~183 KB
setup.public.js     ~175 KB
stars.public.js     ~174 KB
```

Add peer dependencies only if you need LLM-powered features:

```bash
bun add @jasonnathan/llm-core ollama
```

Set `OLLAMA_MODEL` and run `gks summarise` or `gks score` as usual. If peers are missing and you attempt to use LLM features, you'll get a runtime error with installation instructions.

## Citation

If you use Geekist Stars in your research or projects, please cite:

```bibtex
@software{nathan_geekist_stars_2025,
  author       = {Jason Joseph Nathan},
  title        = {Geekist Stars},
  year         = {2025},
  publisher    = {GitHub},
  journal      = {GitHub repository},
  howpublished = {\url{https://github.com/theGeekist/stars}},
}
```
