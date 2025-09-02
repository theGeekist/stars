# Geekist Stars: A Local, Auditable Pipeline for Curating GitHub Repositories

## Abstract

Geekist Stars is a Bun and TypeScript toolkit that turns personal GitHub Lists into an auditable corpus of repositories with computed health signals, locally generated summaries, and topic metadata. The system is designed for reproducibility and privacy. All LLM work runs on Ollama with a user selected local model, and all state is stored in SQLite for inspection and analysis. The project demonstrates that lightweight signals, concise model prompts, and explicit policies are sufficient to keep a large star collection organized without cloud dependencies.

## Motivation

Developers often accumulate hundreds or thousands of starred repositories. Over time, recall and organization degrade, and it becomes hard to decide where a repository belongs or why it was important. Existing tools provide search and browsing, but they rarely combine list curation, explainable scoring, and topic-level structure in a way that is private, traceable, and easy to iterate on. This project aims to fill that gap with a local first pipeline.

## Problem Statement

Given a user’s GitHub Lists and starred repositories, build a local system that:

1. Summarizes each repository in one paragraph suitable for an experienced engineer.
2. Scores repositories against user defined list criteria and proposes list updates.
3. Enriches repositories with topic metadata sourced offline from a local clone of `github/explore`.
4. Persists everything in a relational store that supports reproducible re-runs, auditing, and downstream analysis.

## Contributions

* **Local LLM workflow** using Ollama. No remote inference. The model is user selectable through configuration.
* **Editable prompt schema** stored in `prompts.yaml`. A setup step generates criteria from the user’s existing Lists that the user can refine.
* **Explainable scoring** that matches repositories to Lists using prompts and a simple, transparent policy. The plan can be applied back to GitHub, or reviewed first.
* **Robust summarization** that combines README content when present with repository metadata. This yields useful summaries even for sparse projects.
* **Offline topic enrichment** that reads topic definitions, aliases, and related links from a local `github/explore` clone referenced by `GH_EXPLORE_PATH`. No network lookups are used in the enrichment step.
* **Auditable storage** in SQLite, including model run identifiers, scores per list, and text indexed with FTS for simple querying.

## System Overview

The pipeline consists of four stages that can be run independently.

1. **Ingest**
   Imports Lists and repositories through the GitHub API, computes simple metrics such as popularity, freshness, and activeness, and normalizes topics. Results are stored in SQLite.

2. **Summarize**
   Generates a single paragraph per repository with an Ollama model. Inputs include README text when available, plus description, languages, topics, and activity metrics. The output is saved to `repo.summary` and indexed for search.

3. **Score**
   Evaluates each repository against user editable criteria derived from the Lists. Scores and rationales are saved to `repo_list_score` and grouped under a `model_run`. A conservative policy produces an add, remove, and review plan. The user may apply changes back to GitHub Lists.

4. **Topics**
   Reconciles `repo.topics` into `repo_topics`, then populates `topics`, `topic_alias`, and `topic_related` by parsing the local `github/explore` repository. This produces display names, short and long descriptions, aliases, and related topic edges without network calls. A report summarizes coverage and usage.

## Data Model (Summary)

* **Lists and membership**: `list`, `list_repo`.
* **Repositories and signals**: `repo` with popularity, freshness, activeness, tags, and `summary`.
* **Text index**: `repo_fts` for basic search over names, descriptions, README text, and summaries.
* **Model audit**: `model_run` and `repo_list_score` for reproducibility of scoring outputs.
* **Topics**: `topics` with display name, short and long descriptions, created by, released, Wikipedia URL, logo, and timestamps.
* **Topic graph**: `topic_alias` for normalization and `topic_related` for undirected edges.
* **Repo to topic**: `repo_topics` derived from GitHub metadata and reconciled locally.

## Methods

### Summarization

The summarizer produces one paragraph with a fixed style. It is prompt driven and uses both repository text and metadata. The approach trades breadth for consistency. The output is short, neutral, and intended for quick recall and triage.

### Scoring and Policy

Scoring converts list criteria into a structured prompt and returns a score and brief rationale per list. A simple policy turns scores into suggested membership changes. The policy is explicit, and the final plan is reported before any changes are applied.

### Topic Enrichment

Topics are harvested from `repo.topics`. Canonical metadata comes from a local clone of `github/explore` pointed to by `GH_EXPLORE_PATH`. Each topic page provides front matter and a Markdown body, which are parsed into the `topics` table. Aliases and related topics populate `topic_alias` and `topic_related`. This design avoids any reliance on an undocumented or unstable API for topic metadata.

## Reproducibility

* All prompts live in versioned YAML and are generated once during setup, then edited in place.
* Each scoring run receives a `model_run` identifier, and all scores are stored with that identifier.
* The database schema evolves through additive migrations to maintain compatibility.
* The system can be re-run from raw inputs to verify outputs.

## Current Scope and Non Goals

* Search is basic and uses FTS with a small set of fields. A richer query interface is possible but not included yet.
* The system does not attempt to guess intent beyond what the prompts and metrics support. Human review is expected before applying changes.

## Limitations

* Summaries are constrained by the quality of available metadata. Repositories without README text or useful descriptions will produce minimal summaries, although the model leverages topics and basic facts to compensate.
* Scoring is only as good as the criteria. Ambiguous or overlapping criteria reduce separation between Lists.
* Topic coverage depends on the local `github/explore` repository. Topics not represented there will have limited metadata.

## Future Work

* A lightweight search and filtering layer over FTS, metrics, and topics.
* Export of the topic and repository graph for visualization and analysis.
* Historical diffing for summaries and scores across model runs.
* Assisted criteria authoring and consistency checks across Lists.

## Ethics and Privacy

All model inference happens locally with Ollama. The database lives on disk and can be inspected or deleted. No summaries or scores are sent to third parties. Applying list updates requires explicit user action.

## Conclusion

Geekist Stars shows that private, local tooling can turn a large and noisy star collection into a structured and navigable corpus. The combination of editable prompts, simple metrics, explainable scoring, and a topic layer derived from a local source yields a curated environment that remains under the user’s control.

## Usage

Environment prerequisites:

- `GITHUB_TOKEN`: required for ingesting lists/repos and applying list updates
- `OLLAMA_MODEL`: local model name for LLM prompts (e.g. `llama3.1:8b`)
- `GH_EXPLORE_PATH`: local clone of `github/explore` for topic enrichment (e.g. `/path/to/github/explore`)

CLI commands:

- Lists and repos
  - `gk-stars lists [--json] [--out <file>] [--dir <folder>]`
  - `gk-stars repos --list <name> [--json]`
- Scoring
  - `gk-stars score (--one <owner/repo> | --all [--limit N]) [--dry] [--resume <id|last>] [--notes <text>] [--fresh]`
- Summarisation
  - `gk-stars summarise (--one <owner/repo> | --all [--limit N]) [--dry] [--resummarise]`
- Ingest
  - `gk-stars ingest [--dir <folder>]` (defaults to `EXPORTS_DIR` or `./exports`)
- Topics
  - `gk-stars topics:enrich [--active] [--ttl <days>]`
  - `gk-stars topics:report [--missing] [--recent] [--json] [--full]`
- Setup
  - `gk-stars setup` (generates `prompts.yaml` criteria from your GitHub lists; uses Ollama when available, otherwise writes placeholders)

Build:

```
bun install
bun run build
```

The build emits `dist/index.js` and `dist/cli.js` and copies `features/setup/.prompts.tmpl.yaml` into the distribution so `gk-stars setup` can run from a package install.
