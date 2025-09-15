# Usage

Back to main README: [README.md](README.md)

This project ships a single CLI named `gk-stars`. Below is a practical guide to what each command does, why you would run it, and small examples you can copy and paste.

---

## Environment

Set these before running the CLI:

- `GITHUB_TOKEN`
  Required for reading your GitHub Stars Lists and applying list updates.

- `OLLAMA_MODEL`
  Local model name for all LLM work. Example `llama3.1:8b`.

- `GH_EXPLORE_PATH`
  Local clone of `github/explore` used for topic metadata. Example `/path/to/github/explore`.

Optional helpers:

- `EXPORTS_DIR` (default `./exports`)
  Where `lists --dir` writes JSON exports and where `ingest` reads them from.

- `DEBUG`
  Set to `true` for verbose logs.

---

## Programmatic Usage (Library)

All CLI features are available in code:

```ts
import { summaries, ranking, starsData, ingest } from "@geekist/stars";

// Summaries with model override & progress
await summaries.summariseAll({
  limit: 25,
  modelConfig: { model: "llama3:8b" },
  onProgress: (e) => e.phase === "summarising" && console.log(e.index),
});

// Ranking one repo
const item = await ranking.rankOne({ selector: "owner/repo", apply: false });

// Ingest
await ingest.ingestAll({ onProgress: (e) => console.log(e.phase) });
```

See `MIGRATION.md` for dispatcher and advanced extension details.

---

## Quick patterns you will use a lot

- **Preview first**
  Most commands write by default. Add `--dry` to preview without writing.

- **One repo vs All repos**
  Use `--one <owner/repo>` to target a single repository. Use `--all` to batch, optionally with `--limit N`.

- **JSON output**
  Add `--json` to print machine-readable results.

- **Streams to disk**
  `lists --dir <folder>` streams each list to its own JSON file and creates an `index.json`.

---

## Command reference

### `gk-stars lists`

Fetch all your GitHub Stars Lists and their repositories.

**Why**
Export for offline processing or to inspect lists quickly.

**Flags**

- `--json` print to stdout as JSON
- `--out <file>` write a single JSON file
- `--dir <folder>` stream every list to its own file and write `index.json`

**Examples**

```bash
gk-stars lists --json
gk-stars lists --out lists.json
gk-stars lists --dir ./exports
```

---

### `gk-stars repos`

Show repositories for one list by name.

**Flags**

- `--list <name>` the list name (case-insensitive)
- `--json` print JSON

**Examples**

```bash
gk-stars repos --list "AI & Machine Learning"
gk-stars repos --list "Productivity & Utilities" --json
```

---

### `gk-stars ingest`

Load previously exported lists into the local SQLite database.

**Flags**

- `--dir <folder>` source folder for `index.json` and list files.
  Defaults to `EXPORTS_DIR` or `./exports`.

**Examples**

```bash
gk-stars ingest
gk-stars ingest --dir ./exports
```

---

### `gk-stars summarise`

Generate a concise summary for each repository using your local Ollama model and store it in `repo.summary`.

**Why**
Summaries improve downstream categorisation and search. The summariser uses repo metadata and works even when READMEs are sparse.

**Flags**

- `--one <owner/repo>` summarise one repo
- `--all [--limit N]` summarise many
- `--dry` preview without saving
- `--resummarise` force regeneration even if a summary exists

**Examples**

```bash
# Preview a single repo
gk-stars summarise --one facebook/react --dry

# Summarise 100 repos and save
gk-stars summarise --all --limit 100

# Programmatic (with model override)
node <<'EOF'
import { summaries } from '@geekist/stars';
const res = await summaries.summariseAll({ limit: 5, modelConfig: { model: 'llama3:8b' } });
console.log(res.stats);
EOF
```

---

### `gk-stars categorise` (alias: `score`)

Evaluate repositories against your lists using the editable criteria in `prompts.yaml`. Optionally update list membership on GitHub.

**Why**
Keep your lists structured. The model rates each repo against each list, proposes add/remove/review actions, and can apply the plan back to GitHub.

**Flags**

- `--one <owner/repo>` or `--all [--limit N]`
- `--dry` preview only
- `--resume <id|last>` continue a previous run
- `--notes <text>` annotate the run
- `--fresh` or `--from-scratch` ignore previous runs

**Examples**

```bash
# Dry-run one repo
gk-stars categorise --one facebook/react --dry

# Plan for 200 repos and apply to GitHub
gk-stars categorise --all --limit 200

# Resume the last run with a note
gk-stars categorise --all --resume last --notes "tuning thresholds"

# Programmatic
node <<'EOF'
import { ranking } from '@geekist/stars';
const r = await ranking.rankAll({ limit: 20, onProgress: e => process.stdout.write('.') });
console.log('\n', r.stats);
EOF
```

---

### `gk-stars topics:enrich`

Populate and refresh topic metadata for your repos using your local `github/explore` clone. No GitHub API calls are needed.

**Why**
Attach repo topics, enrich them with canonical names and descriptions, and reconcile aliases/related links.

**Flags**

- `--active` process only non-archived repos
- `--ttl <days>` refresh metadata if older than this

**Examples**

```bash
gk-stars topics:enrich
gk-stars topics:enrich --active --ttl 14
```

---

### `gk-stars topics:report`

Display topic statistics from your database.

**Flags**

- `--missing` show topics without metadata
- `--recent` show most recently attached topics
- `--full` do not truncate descriptions or aliases
- `--json` print JSON

**Examples**

```bash
gk-stars topics:report
gk-stars topics:report --full
gk-stars topics:report --missing --recent
gk-stars topics:report --json > topics.json
```

---

### `gk-stars setup`

Generate `prompts.yaml` from your current GitHub lists.
If Ollama is available, the tool proposes first-pass criteria; otherwise it writes placeholders to edit manually.

**Examples**

```bash
gk-stars setup
```

---

## Suggested first run

```bash
# 1) Generate prompts from your lists
gk-stars setup

# 2) Export all lists, then ingest to the DB
gk-stars lists --dir ./exports
gk-stars ingest --dir ./exports

# 3) Create summaries using a local model
gk-stars summarise --all --limit 200

# 4) Categorise and preview changes
gk-stars categorise --all --limit 200 --dry

# 5) Apply when happy
gk-stars categorise --all --limit 200
```

---

## Notes on models and prompts

- All LLM work runs through your local Ollama runtime. Set `OLLAMA_MODEL` to choose the model that fits your machine.
- `prompts.yaml` is fully editable. Update criteria anytime, then re-run categorisation.
- Categorisation uses summaries + repo metadata to reduce hallucination and keep criteria grounded.

---

## Build

```bash
bun install
bun run build
```

Build outputs:

- `dist/cli.js` — CLI entry
- `dist/index.js` — library entry

The `setup` template is bundled so `gk-stars setup` works after install.
