# Wiki Feature

Generates internal documentation pages ("wiki") from the project source using a multi-step pipeline: retrieve, chunk, embed/context plan, generate, polish, and write pages. This feature is auxiliary and not part of the core public API exposed to consumers of the library.

## Purpose

- Provide structured, navigable docs derived from code comments & source files.
- Experiment with retrieval + generation workflows locally (Ollama-driven).
- Maintain auditable run artifacts in `.wiki_runs/`.

## Status

Internal. No stable public wrapper is exported. The raw logs (`run-pipeline.md`, etc.) are ignored from version control to keep the repo lean.

## High-Level Phases

1. Collect documents (source selection)
2. Chunk content (size + semantic boundaries)
3. Plan context (token budgeting)
4. Retrieve per-topic/page slices
5. Generate draft pages (LLM)
6. Repair / polish missing metadata
7. Final write & checkpoint artifacts

## Configuration

Relies on the same local Ollama setup and environment variables used elsewhere (`OLLAMA_MODEL` by default). Future iterations may adopt the per-request `modelConfig` pattern used in summaries/ranking.

## Extending

If you want to productise this:

- Extract option objects similar to `summaries` / `ranking` public modules.
- Provide `onProgress` events (e.g. `wiki:chunk`, `wiki:generate`, `wiki:polish`).
- Add a dispatcher kind (e.g. `wiki:generate`) with a typed options interface.

## NOTE

Large historical logs were removed / ignored to enforce the zero-noise repository policy—regenerate by re-running the pipeline scripts if needed.
