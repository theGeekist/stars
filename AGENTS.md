Before committing, run and ensure all of these commands succeed (set `CI=1` in your shell first to avoid session interruptions):

- CI=1 bun run build
- CI=1 bun lint --fix
- CI=1 bun test

Testing notes:

- `bunfig.toml` enables coverage collection and preloads `test-setup.ts`, which automatically resets `Bun.env`, `process.cwd()`, and `process.exit` between tests.
- Coverage reporters are `text` and `lcov`; test files, mocks, and the `src/__test__` helpers directory are excluded via `coveragePathIgnorePatterns`.

## Host CLI and operational MCP access

Follow `/home/jasonjn/Repos/AGENTS.md` and `/srv/AGENTS.md` for existing authenticated host CLIs, WP-CLI and operational MCP servers. Check the relevant connector and authorised host environment before concluding that sandbox restrictions mean a tool, service or login is unavailable. Verify the intended identity and access without revealing credentials.

## Git hook integrity

Never bypass, disable, skip, suppress, or work around a Git hook or required check for a commit or push unless the user explicitly approves that specific bypass. A request to commit or push does not grant bypass approval. When a hook or check fails, fix the underlying issue and rerun it with the hook enabled. If the hook cannot be made to pass, stop before committing or pushing and report the failure for user direction.
