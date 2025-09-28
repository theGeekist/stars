# Stars

[![npm version](https://img.shields.io/npm/v/@geekist/stars.sv- Summaries: `gks summarise --all --limit 500 --resummarise` (force rebuilds)

- Ranking: `gks score --all --resume last` (continue the previous batch)](https://www.npmjs.com/package/@geekist/stars)
  [![Build Status](https://github.com/theGeekist/stars/actions/workflows/ci.yml/badge.svg)](https://github.com/theGeekist/stars/actions/workflows/ci.yml)
  [![License](https://img.shields.io/npm/l/@geekist/stars.svg)](https://github.com/theGeekist/stars/blob/main/LICENSE)

---

## Abstract

Geekist Stars is a local-first, open-source tool to manage your GitHub starred repos and lists.

- Sync your stars and lists offline.
- Summarise repos with local LLMs.
- Categorise repos into lists using criteria.
- Enrich and report on topics.
- Plan and apply list membership changes.

### Models (Mac quick-pick)

- **16 GB RAM**: summarise → `llama3.1:8b`; ranking → `qwen2.5:7b` or `llama3.1:8b` (slower)
- **32 GB+ RAM**: summarise → `qwen2.5:7b`; ranking → `llama3.1:8b` / `qwen2.5:7b`

Tips:

- Prefer `:Q4_K_M` or similar quant for speed.
- If you notice thrash, set `OLLAMA_NUM_PARALLEL=1`.

## Curation Mode

Geekist Stars helps you curate your GitHub stars by generating summaries and scoring repos against your lists using editable criteria.

## Motivation

Starred repos are a personal knowledge base, but GitHub’s UI is limited:

- No bulk export/import.
- No automated categorisation.
- No summary or rationale for stars.
- No local audit trail.

Geekist Stars fills this gap with a **local-first pipeline**.

### Why not SaaS stars managers?

- **Private by default**: no repo content leaves your machine.
- **Auditable**: every decision (scores, rationales, runs) is in SQLite.
- **Composable**: build your own reports with `SELECT`, not a black‑box UI.

## Data Model (Summary)

- `repo`: repositories with metadata and summaries.
- `list`: your GitHub stars lists.
- `membership`: repo membership in lists.
- `topic`: topics attached to repos.
- `model_run`: LLM run metadata.

### Signals (glossary)

- **popularity**: log‑scaled stars & forks (decays with age)
- **freshness**: last‑commit recency windowed over 180 days
- **activeness**: commits/issues/PRs velocity normalised per repo size

## Reproducibility

- Use `model_run` to track LLM invocations.
- Use `--resume` flags to continue interrupted runs.

### Resuming work

Long runs persist progress per `model_run`.

- Summaries: `gk-stars summarise --all --limit 500 --resummarise` (force rebuilds)
- Ranking: `gk-stars score --all --resume last` (continue the previous batch)

## Automation (nightly)

Run the orchestrator every night (example: 1 am), then review plans in the morning.

```bash
0 1 * * *  bun /path/to/stars/scripts/orchestrator.ts --only=lists,ingest,summarise,score >> /path/to/stars/logs/cron.out 2>&1
```

## Without peers

Without those peers only the non-LLM features (lists, stars data export, ingest, topics) are usable.

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

## CLI Usage

### Setup and Initial Import

```bash
# Initial setup - creates database and prompts
gks setup

# Import your GitHub stars and lists
gks ingest
```

### Scoring and Categorization

**Basic scoring workflow:**

```bash
# Preview scoring changes (dry run)
gks score --all --dry

# Apply scoring changes
gks score --all

# Score a single repository
gks score --one facebook/react --dry
```

**Curation with custom threshold:**

The `--curation-threshold` flag controls when manually curated repositories are removed from lists. The default threshold is 0.2 (repositories with scores below this are candidates for removal).

```bash
# Use default curation threshold (0.2)
gks score --all --dry

# Use a lower threshold to be more selective (keep more repos)
gks score --all --curation-threshold 0.1 --dry

# Use a higher threshold to be more aggressive (remove more repos)
gks score --all --curation-threshold 0.3 --dry

# Score a single repo with custom threshold
gks score --one facebook/react --curation-threshold 0.15
```

### Summaries

```bash
# Generate summaries for all repos (dry run)
gks summarise --all --dry

# Generate summaries with limit
gks summarise --all --limit 100

# Summarise a single repository
gks summarise --one microsoft/vscode
```

### Other Commands

```bash
# List your GitHub stars lists
gks lists

# Export data in various formats
gks export

# Get help for any command
gks score --help
gks summarise --help
```
