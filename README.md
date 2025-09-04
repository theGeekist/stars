<div align="center">
  <img src="logo.jpg" alt="Geekist Stars Logo" width="600" />
  <h1>Geekist Stars</h1>

  <p>A Local, Auditable Pipeline for Curating your Starred GitHub Repositories</p>

  <p>
    <a href="https://sonarcloud.io/summary/new_code?id=theGeekist_stars">
      <img alt="Quality Gate Status" src="https://sonarcloud.io/api/project_badges/measure?project=theGeekist_stars&metric=alert_status" />
    </a>       
    <a href="https://app.codecov.io/gh/theGeekist/stars">
      <img alt="Coverage" src="https://codecov.io/gh/theGeekist/stars/branch/main/graph/badge.svg" />
    </a>
    <a href="USAGE.md">
      <img alt="Docs" src="https://img.shields.io/badge/docs-usage-blue" />
    </a>
    <img alt="License" src="https://img.shields.io/badge/License-MIT-green.svg" />
  </p>

</div>

## Quickstart

```bash
bun install && bun run build && gk-stars setup
```

## Abstract

Geekist Stars is a Bun and TypeScript toolkit that turns personal GitHub Lists and starred repositories into an auditable corpus with computed health signals, locally generated summaries, explainable categorisation, and enriched topic metadata.

The system is designed for **reproducibility and privacy**:

- All LLM work runs locally through Ollama with a user-selected model.
- All state is stored in SQLite for inspection, analysis, and replay.

The project demonstrates that lightweight signals, concise prompts, and explicit policies are sufficient to keep a large star collection structured and navigable — without cloud dependencies.

> Looking for CLI usage? See [USAGE.md](USAGE.md) for command-by-command examples and flags.

## Motivation

Developers often accumulate hundreds or thousands of starred repositories. Over time, recall and organisation degrade, and it becomes hard to remember why a repository mattered or where it belongs. Existing tools provide search and browsing, but they rarely combine:

- **List curation**
- **Concise summaries**
- **Explainable categorisation**
- **Topic-level enrichment**

all in a way that is private, reproducible, and easy to extend.

Geekist Stars fills this gap with a **local-first pipeline**.

## Problem Statement

Given a user’s GitHub Lists and starred repositories, build a local system that:

1. Summarises each repository in one paragraph suitable for an experienced engineer.
2. Categorises repositories against user-defined list criteria and proposes updates.
3. Enriches repositories with topic metadata sourced offline from a local clone of `github/explore`.
4. Persists everything in a relational store that supports reproducible re-runs, auditing, and downstream analysis.

## Contributions

- **Local LLM workflow** using Ollama. No remote inference.
- **Editable prompt schema** in `prompts.yaml`. A setup step generates list criteria that can be refined.
- **Explainable categorisation** that matches repositories to lists using transparent prompts and policies. Results can be applied back to GitHub or reviewed first.
- **Robust summarisation** combining README text, repo metadata, and activity signals into short neutral summaries.
- **Offline topic enrichment** by parsing a local clone of `github/explore`. No network lookups.
- **Auditable storage** in SQLite with identifiers for each model run, full scores, and indexed text.

## System Overview

The pipeline consists of four stages that can be run independently.

1. **Ingest**
   Imports lists and repositories via the GitHub API. Computes simple metrics such as popularity, freshness, and activeness, then normalises topics. Results are stored in SQLite.

2. **Summarise**
   Generates a single paragraph per repository using an Ollama model. Inputs include README text (when available), description, languages, topics, and activity metrics. Output is saved to `repo.summary` and indexed for search.

3. **Categorise**
   Evaluates each repository against editable list criteria. Scores and rationales are saved to `repo_list_score` under a `model_run`. A conservative policy proposes add/remove/review actions, which can be applied back to GitHub Lists.

4. **Topics**
   Reconciles `repo.topics` into `repo_topics`, then populates `topics`, `topic_alias`, and `topic_related` by parsing the local `github/explore` repository. This produces display names, descriptions, aliases, and related topic edges without network calls. A report summarises coverage and usage.

## Data Model (Summary)

- **Lists and membership**: `list`, `list_repo`.
- **Repositories and signals**: `repo` with popularity, freshness, activeness, tags, and `summary`.
- **Text index**: `repo_fts` for search over names, descriptions, README text, and summaries.
- **Model audit**: `model_run`, `repo_list_score` for reproducibility of categorisation.
- **Topics**: `topics` with metadata from `github/explore`.
- **Topic graph**: `topic_alias` for normalisation and `topic_related` for edges.
- **Repo-to-topic**: `repo_topics` derived from metadata and reconciled locally.

## Methods

### Summarisation

Summaries are generated in a fixed style: 60–90 words, factual, and present-tense. They use both repository text and metadata. The goal is fast recall and triage rather than depth.

### Categorisation and Policy

Categorisation converts list criteria into structured prompts. Each repo receives a score and rationale per list. A simple explicit policy turns scores into suggested add/remove/review actions. The plan is reported before any changes are applied.

### Topic Enrichment

Topics are harvested from `repo.topics`. Metadata is parsed from a local `github/explore` clone (`GH_EXPLORE_PATH`). Front matter provides descriptions, while Markdown bodies supply related links. Aliases and related topics populate `topic_alias` and `topic_related`.

This avoids reliance on undocumented or unstable APIs.

## Reproducibility

- Prompts live in versioned YAML, generated once during setup and edited in place.
- Each categorisation run has a unique `model_run` identifier; all scores are stored with it.
- The database evolves via additive migrations to maintain compatibility.
- The system can be re-run end-to-end to verify outputs.

## Current Scope and Non-Goals

- Search is basic (SQLite FTS). Richer querying is possible but not included.
- No attempt is made to infer beyond prompts and metrics. Human review is expected.

## Limitations

- Summaries depend on metadata quality. Repos with poor READMEs yield minimal summaries.
- Categorisation quality depends on criteria clarity. Overlapping lists reduce separation.
- Topic coverage is bounded by what exists in `github/explore`.

## Future Work

- Advanced search and filtering over FTS, metrics, and topics.
- Graph export for repos and topics.
- Historical diffing across model runs.
- Assisted criteria authoring and cross-list consistency checks.

## Ethics and Privacy

All inference runs locally via Ollama. The SQLite database remains on disk, fully inspectable and removable. No summaries, scores, or repo data are sent to third parties. Applying list updates to GitHub requires explicit user action.

## Conclusion

Geekist Stars shows that local-first tooling can transform a noisy GitHub star collection into a structured, auditable, and navigable corpus. By combining editable prompts, simple metrics, explainable categorisation, and topic enrichment from a local source, the system provides a curated environment that stays under the user’s control.

## Citation

If you use **Geekist Stars** in your research or projects, please cite:

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
