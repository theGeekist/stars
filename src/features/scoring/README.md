# Scoring / Categorise Feature

Evaluates repositories against list criteria, persists per-list scores/rationales, and turns them into an **add / remove / keep / review** plan.
Backed by SQLite tables: `model_run`, `repo_list_score`, `list_repo`.

- **Prereq**: summaries exist (`r.summary` non-empty).
- **Run-aware**: new runs, resume runs, or dry-run filters.
- **Policy**: threshold-driven with safety rails (min stars, avoid listless, preserve sets).

---

## Import / DI

```ts
import { createScoringService } from '@features/scoring';

const svc = createScoringService(database?); // Database from 'bun:sqlite' optional
```

- `database` _(optional)_: if omitted, `withDB()` opens the default DB.

---

## Tables (expected)

- `model_run(id INTEGER PK, notes TEXT, created_at DEFAULT now)`
- `repo_list_score(run_id, repo_id, list_slug, score REAL, rationale TEXT, PK(run_id, repo_id, list_slug))`
- `repo` (must include `summary`, popularity, freshness, etc.)
- `list_repo(list_id, repo_id)` for actual membership (managed elsewhere)

---

## Public API

```ts
type ScoringService = {
  getLastRunId(): number | null;
  createRun(notes?: string): number;
  resolveRunContext(opts: {
    dry: boolean;
    notes?: string;
    resume?: ResumeFlag;
  }): { runId: number | null; filterRunId: number | null };
  selectRepos(sel: BatchSelector, filterRunId: number | null): RepoRow[];
  persistScores(runId: number, repoId: number, scores: ScoreItem[]): void;
  planTargets(
    current: string[],
    scores: ScoreItem[],
    cfg?: Thresholds,
  ): PlanResult;
  planMembership(
    repo: RepoRow,
    current: string[],
    scores: ScoreItem[],
    policy?: ApplyPolicy,
  ): PlanMembershipResult;
};
```

### Types (excerpt)

```ts
// Input to model:
type ScoreItem = { list: string; score: number; why?: string };

// Batch selection:
type BatchSelector = { limit?: number; listSlug?: string };

// Threshold config:
type Thresholds = {
  defaultAdd?: number; // default 0.7
  remove?: number; // default 0.3
  addBySlug?: Record<string, number>; // per-list override
  preserve?: Set<string>; // lists never removed once present
};

// Policy for membership:
type ApplyPolicy = {
  thresholds?: Thresholds;
  minStars?: number; // block changes if repo.stars < minStars
  avoidListless?: boolean; // if planned empty, pick best "review" as fallback
};

// Planning results:
type PlanResult = {
  planned: string[]; // keep + add (deduped)
  add: string[];
  remove: string[];
  keep: string[];
  review: string[]; // above remove threshold but below add threshold
};

type PlanMembershipResult = PlanResult & {
  finalPlanned: string[]; // after policy (fallback/preserve) is applied
  changed: boolean; // finalPlanned != current
  blocked: boolean;
  blockReason?: string;
  fallbackUsed: { list: string; score: number } | null;
};
```

---

## Batching (SQL)

Only repos with a **non-empty summary** are considered. Results are ordered by `popularity DESC, freshness DESC`.

```ts
// Global (no list filter). If filterRunId is provided, exclude repos already scored in that run.
selectRepos({ limit }, filterRunId);

// Scoped to a list (joins list_repo). Also excludes in-run already-scored repos if filterRunId provided.
selectRepos({ limit, listSlug }, filterRunId);
```

**Notes**

- `SUMMARY_PRED = r.summary IS NOT NULL AND length(trim(r.summary)) > 0`

- The default batch query uses the predicate:

  ```sql
  WHERE SUMMARY_PRED AND (? IS NULL) OR NOT EXISTS (
    SELECT 1 FROM repo_list_score s WHERE s.repo_id = r.id AND s.run_id = ?
  )
  ```

  Operator precedence means:
  `(SUMMARY_PRED AND (? IS NULL)) OR NOT EXISTS(...)`
  i.e. **include** repos with summary when `filterRunId` is null, or repos **not yet scored** in that run when provided. (Mirrors your current intent.)

- `limit` is coerced to `>= 1` (default 10).

---

## Runs

```ts
const last = svc.getLastRunId(); // or null
const runId = svc.createRun("tuning prompts");

const { runId, filterRunId } = svc.resolveRunContext({
  dry: true | false,
  notes: "note for new run when needed",
  resume: "last" | 17 | undefined,
});
```

- `resolveRunContext` logic:
  - `resume: "last"` → use last run if exists; create new if not (unless `dry`).
  - `resume: number` → validate it exists; use it (or just filter if `dry`).
  - otherwise → `dry` = filter only; non-dry = create a new run.

---

## Persisting LLM scores

```ts
// After you obtain model scores (array of {list, score, why?}):
svc.persistScores(runId, repoId, scores);
```

- Upsert into `repo_list_score` on `(run_id, repo_id, list_slug)`
- Updates both `score` and `rationale` on conflict.

---

## Planning (thresholds → actions)

### `planTargets(current, scores, cfg?)`

- **Inputs**
  - `current`: current list slugs on the repo (local view)
  - `scores`: model outputs `{ list, score }`
  - `cfg`:
    - `defaultAdd` (default **0.7**)
    - `remove` (default **0.3**)
    - `addBySlug` allows per-list add thresholds
    - `preserve` a set of lists never removed

- **Logic**
  - `keep` = `current` where `score > remove`
  - `review` = lists in `scores` where `remove < score < add-threshold`
  - `add` = lists in `scores` where `score ≥ add-threshold` and not already `keep`
  - `planned` = `dedupe(keep + add)`
  - Ensure `preserve` slugs in `current` remain in `planned`
  - `remove` = `current` − `planned` − `preserve`

### `planMembership(repo, current, scores, policy?)`

Extends `planTargets` with policy safeguards:

- `minStars` → if `repo.stars < minStars`, **block** changes.
- `avoidListless` → if `planned` empty:
  - choose the highest-scoring **review** item as a single fallback; else **block** with reason.

- Always re-add `preserve` sets from `current`.
- Returns `finalPlanned`, `changed`, `blocked`, `blockReason`, and any `fallbackUsed`.

---

## Programmatic usage

```ts
import { createScoringService } from "@features/scoring";

const svc = createScoringService();

// 1) Resolve run context
const { runId, filterRunId } = svc.resolveRunContext({
  dry: false,
  notes: "baseline",
});

// 2) Pick a batch (global or by list)
const batch = svc.selectRepos({ limit: 50 }, filterRunId);

// 3) For each repo → call your LLM, then persist
for (const repo of batch) {
  const scores = await llmScore(repo); // returns ScoreItem[]
  svc.persistScores(runId!, repo.id, scores);

  // 4) Turn scores into a plan
  const current = await listsSvc.read.currentMembership(repo.id);
  const plan = svc.planMembership(repo, current, scores, {
    thresholds: {
      defaultAdd: 0.75,
      remove: 0.35,
      addBySlug: { "ai-machine-learning": 0.8 },
      preserve: new Set(["interesting-to-explore"]),
    },
    minStars: 5,
    avoidListless: true,
  });

  // 5) Apply plan (elsewhere): reconcile local, then push to GitHub
  if (!plan.blocked && plan.changed) {
    await listsSvc.apply.reconcileLocal(repo.id, plan.finalPlanned);
    // map to GH IDs + updateOnGitHub(...) as per Lists Feature
  }
}
```

---

## CLI mapping

This feature powers:

- `gk-stars categorise` _(alias: `score`)_
  - `--one <owner/repo>` or `--all [--limit N]`
  - `--dry`
  - `--resume <id|last>`
  - `--notes <text>`
  - `--fresh` / `--from-scratch` (selection behaviour handled by caller)

---

## Design choices & guarantees

- **Summary prerequisite** keeps prompts grounded and reduces hallucination.
- **Run IDs** make categorisation reproducible and diffable.
- **Upserted scores** simplify re-runs and iterative tuning.
- **Policy separation** means you can change thresholds without re-scoring.

---

## Footguns / gotchas

- **Operator precedence** in the default batch WHERE clause is intentional:
  `(SUMMARY_PRED AND (? IS NULL)) OR NOT EXISTS(…run…)`
  If you want strictly **both** summary and run-exclusion simultaneously, wrap with parentheses accordingly.
- **Preserve set** only prevents **removals**; it doesn’t force an **add** if not already present.
- **avoidListless** fallback only pulls from `review`. If nothing qualifies, the plan is blocked—by design.
