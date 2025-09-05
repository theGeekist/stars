import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randBase36 } from "@lib/rand";

/** Create a temp dir, chdir into it, run `fn`, always restore & cleanup. */
export async function inTempDir<T>(
	seedFiles: Record<string, string> | null,
	fn: () => Promise<T> | T,
): Promise<T> {
	const prev = process.cwd();
	const dir = mkdtempSync(join(tmpdir(), `.prompts-test-${randBase36(8)}-`));
	try {
		process.chdir(dir);
		if (seedFiles) {
			for (const [p, content] of Object.entries(seedFiles)) {
				writeFileSync(p, content);
			}
		}
		return await fn();
	} finally {
		process.chdir(prev);
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Convenience for writing prompts.yaml with a string block. */
export function promptsYaml(criteriaBlock: string, extra?: string): string {
	return [
		"scoring:",
		`  criteria: |`,
		criteriaBlock
			.split("\n")
			.map((l) => (l.length ? `    ${l}` : l))
			.join("\n"),
		"summarise:",
		'  one_paragraph: "x"',
		extra ? extra : "",
		"",
	].join("\n");
}
