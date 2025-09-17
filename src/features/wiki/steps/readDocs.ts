// src/features/wiki/steps/readDocs.ts

import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
// Replaced external glob + tokenizer with Bun.Glob and heuristic tokens
import type {
	Doc,
	FilterOptions,
	ReadOutput,
	ResolvedRepo,
	Step,
} from "../types.ts";

// Approximate token counter (avg ~4 chars per token)
const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));
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

const tok = approxTokens;

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
	const T = tok(text);
	if (T <= tokenCap) return text;
	const headTokens = Math.floor(tokenCap * 0.7);
	const tailTokens = tokenCap - headTokens - 32; // reserve for marker
	if (tailTokens <= 0) {
		const headChars = headTokens * 4;
		return `${text.slice(0, headChars)}\n\n<!-- TRUNCATED -->`;
	}
	const headChars = headTokens * 4;
	const tailChars = tailTokens * 4;
	const head = text.slice(0, headChars);
	const tail = text.slice(Math.max(0, text.length - tailChars));
	return `${head}\n\n<!-- TRUNCATED: middle omitted to respect token cap -->\n\n${tail}`;
}

// Compile ignore patterns into Bun.Glob instances for quick matching
type BunGlob = InstanceType<typeof Bun.Glob>;
function compileIgnore(patterns: string[]): Array<{ g: BunGlob; raw: string }> {
	return patterns.map((p) => ({ g: new Bun.Glob(p), raw: p }));
}

function isIgnored(
	relPath: string,
	ignores: Array<{ g: BunGlob; raw: string }>,
): boolean {
	return ignores.some(({ g }) => g.match(relPath));
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

		const ignoreGlobs = compileIgnore(ignores);
		for (const isCode of [true, false] as const) {
			const exts = isCode ? CODE_EXT : DOC_EXT;
			for (const ext of exts) {
				const g = new Bun.Glob(`**/*${ext}`);
				for await (const relFile of g.scan({ cwd: doc.repoRoot })) {
					// relFile is POSIX relative path from cwd (Bun behavior)
					const rel = toPosix(relFile);
					if (isIgnored(rel, ignoreGlobs)) continue;
					if (!include(rel, mode, filter)) continue;
					const abs = join(doc.repoRoot, relFile);
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
