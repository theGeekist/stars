// src/features/wiki/steps/readDocs.ts

import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { glob } from "glob";
import { getEncoding } from "js-tiktoken";
import type {
	Doc,
	FilterOptions,
	ReadOutput,
	ResolvedRepo,
	Step,
} from "../types.ts";

const enc = getEncoding("cl100k_base");
const CODE_EXT = [
	".py",
	".js",
	".ts",
	".java",
	".cpp",
	".c",
	".h",
	".hpp",
	".go",
	".rs",
	".jsx",
	".tsx",
	".html",
	".css",
	".php",
	".swift",
	".cs",
];
const DOC_EXT = [".md", ".txt", ".rst", ".json", ".yaml", ".yml"];
const MAX_EMBED = 8192;

// Conservative default ignores to keep the scanner lean
const DEFAULT_IGNORED_DIRS = [
	"**/node_modules/**",
	"**/.git/**",
	"**/.hg/**",
	"**/.svn/**",
	"**/.idea/**",
	"**/.vscode/**",
	"**/dist/**",
	"**/build/**",
	"**/out/**",
	"**/target/**",
	"**/.next/**",
	"**/.svelte-kit/**",
	"**/.nuxt/**",
	"**/.cache/**",
	"**/__pycache__/**",
	"**/.venv/**",
	"**/venv/**",
	"**/env/**",
	"**/coverage/**",
	"**/logs/**",
];

function tok(s: string): number {
	try {
		return enc.encode(s).length;
	} catch {
		return Math.max(1, s.length >> 2);
	}
}

function toPosix(relPath: string): string {
	// Convert platform-specific separators to POSIX for stable downstream behaviour
	return relPath.split(sep).join("/");
}

function parts(p: string): string[] {
	return p.split(sep).filter(Boolean);
}

function include(
	rel: string,
	mode: "include" | "exclude",
	f: FilterOptions,
): boolean {
	const ps = parts(rel);
	const base = rel.split("/").pop() ?? rel;

	if (mode === "include") {
		const d = new Set(
			(f.includedDirs ?? []).map((x) => x.replace(/^[./]+|\/+$/g, "")),
		);
		const files = f.includedFiles ?? [];
		const inDir = ps.some((p) => d.has(p.replace(/^[./]+|\/+$/g, "")));
		const inFile = files.some((x) => base === x || base.endsWith(x));
		if (d.size === 0 && files.length === 0) return true;
		return inDir || inFile;
	}

	// exclude mode
	const d = new Set(
		(f.excludedDirs ?? []).map((x) => x.replace(/^[./]+|\/+$/g, "")),
	);
	const fi = new Set(f.excludedFiles ?? []);
	const inDir = ps.some((p) => d.has(p.replace(/^[./]+|\/+$/g, "")));
	const inFile = fi.has(base);
	return !(inDir || inFile);
}

/** Keep big files but sample them to stay token-safe. */
function sampleLarge(text: string, tokenCap: number): string {
	// Simple head + tail sampler with a marker in the middle
	const T = tok(text);
	if (T <= tokenCap) return text;

	// Split the budget roughly 70/30 head/tail for code/document signal retention
	const headBudget = Math.floor(tokenCap * 0.7);
	const tailBudget = tokenCap - headBudget - 64; // leave a little for the marker
	if (tailBudget <= 0) {
		// extreme edge; just trim head
		const headSlice = enc.decode(enc.encode(text).slice(0, tokenCap));
		return `${headSlice}\n\n<!-- TRUNCATED -->`;
	}

	const encAll = enc.encode(text);
	const headSlice = enc.decode(encAll.slice(0, headBudget));
	const tailSlice = enc.decode(encAll.slice(encAll.length - tailBudget));

	return `${headSlice}\n\n<!-- TRUNCATED: middle omitted to respect token cap -->\n\n${tailSlice}`;
}

export function stepReadDocs(
	filter: FilterOptions = {},
): Step<ResolvedRepo, ReadOutput> {
	return (log) => async (doc) => {
		const useIncl = Boolean(
			filter.includedDirs?.length || filter.includedFiles?.length,
		);
		const mode: "include" | "exclude" = useIncl ? "include" : "exclude";
		const out: Doc[] = [];

		// Compose glob ignores from defaults + explicit directory exclusions (exclusive mode only).
		const ignores = useIncl
			? DEFAULT_IGNORED_DIRS.slice()
			: DEFAULT_IGNORED_DIRS.concat(
					(filter.excludedDirs ?? []).map(
						(d) => `**/${d.replace(/^[./]+|\/+$/g, "")}/**`,
					),
				);

		for (const isCode of [true, false] as const) {
			const exts = isCode ? CODE_EXT : DOC_EXT;

			for (const ext of exts) {
				const files = await glob(
					`${doc.repoRoot.replace(/[/\\]+$/, "")}/**/*${ext}`,
					{
						nodir: true,
						ignore: ignores,
					},
				);

				for (const abs of files) {
					const relNative = relative(doc.repoRoot, abs);
					const rel = toPosix(relNative); // POSIX path
					if (!include(rel, mode, filter)) continue;

					const text = await readFile(abs, "utf8").catch(() => "");
					if (!text) continue;

					const cap = isCode ? MAX_EMBED * 10 : MAX_EMBED;
					const textFinal = tok(text) > cap ? sampleLarge(text, cap) : text;

					out.push({
						id: `${rel}#0:${textFinal.length}`,
						text: textFinal,
						meta: {
							repoRoot: doc.repoRoot,
							filePath: rel,
							isCode,
							tokenCount: tok(textFinal),
						},
					});
				}
			}
		}

		log.info?.(`Read ${out.length} documents`);
		return { ...doc, rawDocs: out };
	};
}
