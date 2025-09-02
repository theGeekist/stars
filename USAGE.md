# Usage

Back to main README: [README.md](README.md)

This project ships a single CLI named `gk-stars`. Below is a practical guide to what each command does, why you would run it, and small examples that you can copy and paste.

---

## Environment

Set these before running the CLI.

- `GITHUB_TOKEN`
  Required for reading your GitHub Stars Lists and for applying list updates.

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

## Quick patterns you will use a lot

- Preview first
  Most commands write by default. Add `--dry` to preview without writing.

- One repo vs All repos
  Use `--one <owner/repo>` to target a single repository. Use `--all` to batch, optionally with `--limit N`.

- JSON output
  Add `--json` to print machine-readable results.

- Streams to disk
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

See also: [src/features/lists/README.md](src/features/lists/README.md)

---

### `gk-stars repos`

Show repositories for one list by name.

**Flags**

- `--list <name>` the list name (case-insensitive)
- `--json` print JSON

**Examples**

```bash
gk-stars repos --list "AI"
gk-stars repos --list "Learning" --json
```

See also: [src/features/lists/README.md](src/features/lists/README.md)

---

### `gk-stars ingest`

Load previously exported lists into the local SQLite database.

**Flags**

- `--dir <folder>` source folder for `index.json` and list files
  Defaults to `EXPORTS_DIR` or `./exports`.

**Examples**

```bash
gk-stars ingest
gk-stars ingest --dir ./exports
```

See also: [src/features/ingest/README.md](src/features/ingest/README.md)

---

### `gk-stars summarise`

Generate a concise summary for each repository using your local Ollama model and store it in `repo.summary`.

**Why**
Good summaries improve downstream scoring and search. The summariser uses the repository metadata and works even without a full README.

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
```

See also: [src/features/summarise/README.md](src/features/summarise/README.md)

---

### `gk-stars score`

Score repositories against your lists, using the editable criteria in `prompts.yaml`. Optionally update list membership on GitHub.

**Why**
Keep your lists tidy. The model ranks each repo against each list, then proposes adds and removes. It can apply the plan to your GitHub account.

**Flags**

- `--one <owner/repo>` or `--all [--limit N]`
- `--dry` preview only
- `--resume <id|last>` continue a previous scoring run
- `--notes <text>` annotate the model run
- `--fresh` or `--from-scratch` ignore previous runs when selecting repos

**Examples**

```bash
# Dry-run one repo
gk-stars score --one facebook/react --dry

# Plan for 200 repos and apply to GitHub
gk-stars score --all --limit 200

# Resume the last model run with a note
gk-stars score --all --resume last --notes "tuning thresholds"
```

See also: [src/features/scoring/README.md](src/features/scoring/README.md)

---

### `gk-stars topics:enrich`

Populate and refresh topic metadata for your repos using your local `github/explore` clone. No GitHub API calls are needed.
This attaches repo topics, then fills `topics` and cross-links aliases and related topics.

**Flags**

- `--active` process only non-archived repos
- `--ttl <days>` refresh metadata if older than this

**Examples**

```bash
gk-stars topics:enrich
gk-stars topics:enrich --active --ttl 14
```

See also: [src/features/topics/README.md](src/features/topics/README.md)

---

### `gk-stars topics:report`

Display topic statistics from your database.

**Flags**

- `--missing` show topics without metadata
- `--recent` show topics most recently attached
- `--full` do not truncate descriptions or aliases
- `--json` print machine-readable output

**Examples**

```bash
gk-stars topics:report
gk-stars topics:report --full
gk-stars topics:report --missing --recent
gk-stars topics:report --json > topics.json
```

See also: [src/features/topics/README.md](src/features/topics/README.md)

---

### `gk-stars setup`

Generate `prompts.yaml` from your current GitHub lists.
If Ollama is available, the tool proposes first-pass criteria. If not, it writes placeholders that you can edit.

**Examples**

```bash
gk-stars setup
```

See also: [src/features/setup/README.md](src/features/setup/README.md)

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

# 4) Score and preview changes
gk-stars score --all --limit 200 --dry

# 5) Apply when happy
gk-stars score --all --limit 200
```

---

## Notes on models and prompts

- All LLM work runs against your local Ollama runtime. Set `OLLAMA_MODEL` to choose the model and size that fits your machine.
- `prompts.yaml` is part of your workflow and is fully editable. Update criteria anytime, then re-run scoring.
- Scoring uses summaries and repository metadata to reduce hallucinations and to keep the criteria focused.

---

## Build

```bash
bun install
bun run build
```

Build outputs:

- `dist/cli.js` the CLI entry
- `dist/index.js` the library entry

The `setup` template is bundled so `gk-stars setup` works after install.
