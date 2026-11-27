# SaaS research candidate reconciliation

PR #6 reconciles GitHub Stars and existing Lists. The host is already configured; use its existing checkout, credentials and pipeline. No new environment or installation is requested.

1. Pin the SaaS candidate manifest to a known revision and review its identities. A default preview also surfaces explicitly listed report leads; an explicit manifest is authoritative and must include any desired additional leads. Unresolved identities and list categories require reporting, not invented assignments.
2. Run a preview with `node scripts/saas-stars.mjs --manifest=/path/to/reviewed.json --account=<account> --report=/path/to/preview.json`. Inspect canonical repository IDs, aliases, missing mappings, existing membership and expected additions. Apply with the same manifest and account plus `--apply`; use a separate report path. Avoid concurrent GitHub list edits; replacement-style list updates cannot be made atomic across independent clients.
3. Record confirmed additions, exceptions, and a second preview. An unclassified candidate may be starred but must not be placed into an invented list. Never create lists or remove stars/memberships.
4. Run the **existing configured local Stars pipeline**, excluding only related-repository discovery/collection backfilling. The ordinary configured list/unlisted ingestion, research, enrichment, summarisation and scoring remain in scope; use the actual established host runner and its existing stage selection. The repository example runner is not evidence of the production workflow. Verify and report each actual stage outcome, including any explicit skips and failures. Do not substitute list-only ingestion for the full requested workflow.

No live account mutation or pipeline run is implied by this document. Keep local reports outside tracked paths and do not include secrets.
