// src/lib/cli.ts
// Minimal, shared CLI helpers for pipelines.

export type SimpleArgs = {
	mode: "one" | "all";
	one?: string; // repo selector (e.g., name_with_owner)
	limit?: number; // cap when cycling all
	apply: boolean; // whether to write/apply side-effects
};

export function parseSimpleArgs(argv: string[]): SimpleArgs {
	let mode: "one" | "all" | undefined;
	let one: string | undefined;
	let limit: number | undefined;
	let apply = false;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--all") {
			mode = "all";
			continue;
		}
		if (a === "--one" && argv[i + 1]) {
			mode = "one";
			one = argv[++i];
			continue;
		}
		if (a === "--limit" && argv[i + 1] && /^\d+$/.test(argv[i + 1])) {
			limit = Number(argv[++i]);
			continue;
		}
		if (a === "--apply") {
			apply = true;
		}
	}

	if (!mode) {
		// default to all if nothing specified
		mode = "all";
	}

	return { mode, one, limit, apply };
}

export const SIMPLE_USAGE = `
Usage (simplified):
  --one <name_with_owner> [--apply]
  --all [--limit N] [--apply]

Notes:
  - Default mode is --all
  - Use --apply to persist or call external APIs
`;
