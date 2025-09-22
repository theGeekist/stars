// src/lib/cli.ts
// Minimal, shared CLI helpers for pipelines.

export type SimpleArgs = {
	mode: "one" | "all";
	one?: string; // repo selector (e.g., name_with_owner)
	limit?: number; // cap when cycling all
	dry: boolean; // when true, no persistence/side-effects (apply = !dry)
};

export function parseSimpleArgs(argv: string[]): SimpleArgs {
	let mode: "one" | "all" | undefined;
	let one: string | undefined;
	let limit: number | undefined;
	let dry = false;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--all") {
			mode = "all";
			continue;
		}
		if (a === "--one" && argv[i + 1]) {
			mode = "one";
			i += 1;
			one = argv[i];
			continue;
		}
		if (a === "--limit" && argv[i + 1] && /^\d+$/.test(argv[i + 1])) {
			i += 1;
			limit = Number(argv[i]);
			continue;
		}
		if (a === "--dry") dry = true;
	}

	if (!mode) {
		// default to all if nothing specified
		mode = "all";
	}

	return { mode, one, limit, dry };
}

export const SIMPLE_USAGE = `
Usage (simplified):
  --one <name_with_owner> [--dry] [--respect-curation]
  --all [--limit N] [--dry] [--respect-curation]

Notes:
  - Default mode is --all
  - Applies changes by default; pass --dry to preview only
  - Use --respect-curation to preserve manual list curation
`;
