# @geekist/stars

Query **GitHub Stars Lists** via GraphQL (the undocumented `viewer.lists` connection), dump JSON,
and lay groundwork to enrich each repo with health signals.

## Quick start

```bash
bun install
cp .env.example .env
# put your token in .env
bun run build
./dist/cli.mjs lists --json
```

Or during development:

```bash
bun run src/cli.ts lists --json
```

### Auth
Bun loads `.env` automatically. You need:

```
GITHUB_TOKEN=ghp_********************************
```

The token must include `read:user` and `public_repo` (private lists require repo scope if they include private repos).

## Commands

- `geek-stars lists`  
  Print all lists (name, description, visibility) and a sample of items.

- `geek-stars dump --out lists.json`  
  Dump all lists + items to a JSON file.

- `geek-stars repos --list "AI"`  
  Print repositories (nameWithOwner, url, stars) from a specific list.

### Notes
- This hits the **undocumented** `viewer.lists` field. It’s been stable, but consider this experimental.
- Item pagination per list is batched to 100; upgrade path is wired, see `TODO` in code.

## Dev
- `bun test` — unit tests
- `bun run lint` / `bun run format` — Biome (install it first)
- `bun run typecheck` — TypeScript (via `bunx tsc`)

## License
MIT