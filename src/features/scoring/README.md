# Scoring Feature

Scores repositories against user‑defined list criteria and plans list membership changes with an explicit policy. Persists results under a `model_run` for auditability.

## Public API

- `createScoringService(db?)` – returns:
  - `resolveRunContext({ dry, notes?, resume? })` → `{ runId, filterRunId }` – handles dry runs, `--resume`, and creating a new `model_run`.
  - `selectRepos(sel, filterRunId)` → `RepoRow[]` – choose batch by popularity/freshness; optionally filter out repos already scored in a run.
  - `persistScores(runId, repoId, scores)` – upsert into `repo_list_score`.
  - `planTargets(currentSlugs, scores, thresholds?)` – compute add/remove/keep/review.
  - `planMembership(repo, currentSlugs, scores, policy?)` – safety checks (min stars), avoid listless with review fallback, preserve personal lists; returns `{ finalPlanned, changed, blocked, blockReason, fallbackUsed, add, remove, review }`.
- `DEFAULT_POLICY` – defaults including per‑list add thresholds, remove threshold, preserve set, `avoidListless`, and `minStars`.

## Usage (programmatic)

```ts
import { createScoringService, DEFAULT_POLICY } from "@features/scoring";

const scoring = createScoringService();
const { runId, filterRunId } = scoring.resolveRunContext({ dry: true });
const repos = scoring.selectRepos({ limit: 10 }, filterRunId);
for (const r of repos) {
  const scores = [
    { list: "productivity", score: 0.8, why: "automation" },
    { list: "learning", score: 0.2 },
  ];
  const current = []; // from lists service
  const plan = scoring.planMembership(r, current, scores, DEFAULT_POLICY);
  // Inspect or apply plan…
}
```

## CLI

- `gk-stars score (--one <owner/repo> | --all [--limit N]) [--dry] [--resume <id|last>] [--notes <text>] [--fresh]`

