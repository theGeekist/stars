# Lists Feature

Utilities and services for working with GitHub Lists. Supports reading repos to score, current membership, mapping between slugs and GitHub list IDs, and applying membership changes back to GitHub via GraphQL.

## Public API

- `createListsService(db?, ghGraphQL?)` – returns:
  - `read.getReposToScore({ limit, listSlug? })` → `RepoRow[]`
  - `read.currentMembership(repoId)` → `string[]`
  - `read.mapSlugsToGhIds(slugs)` → `string[]` (GitHub IDs)
  - `read.getListDefs()` → `{ slug, name, description }[]`
  - `apply.reconcileLocal(repoId, slugs)` – make `list_repo` mapping match `slugs`
  - `apply.updateOnGitHub(token, repoGlobalId, listIds)` – apply membership
  - `apply.ensureListGhIds(token)` – fill missing `list.list_id` by matching names from GitHub
  - `apply.ensureRepoGhId(token, repoId)` – resolve and cache a repo’s global ID

## Usage (programmatic)

```ts
import { createListsService } from "@features/lists";
const svc = createListsService();
const defs = await svc.read.getListDefs();
const repos = await svc.read.getReposToScore({ limit: 5, listSlug: defs[0].slug });
const current = await svc.read.currentMembership(repos[0].id);
```

## CLI

- `gk-stars lists [--json] [--out <file>] [--dir <folder>]`
- `gk-stars repos --list <name> [--json]`

