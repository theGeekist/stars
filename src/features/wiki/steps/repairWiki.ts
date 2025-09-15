// src/pipeline/steps/repairWiki.ts

import { readFile } from "node:fs/promises";
import { gen } from "@lib/ollama";
import { slugify } from "@lib/utils";
import type { Step, StoreDoc, WikiOutput } from "../types";
import { uniq } from "../utils";

/* ────────────── utils ────────────── */
function looksLikeTOC(title: string) {
	const t = title.toLowerCase().trim();
	return t === "table of contents" || t === "contents" || /^toc\b/.test(t);
}

async function loadStore(path: string): Promise<StoreDoc[]> {
	const raw = await readFile(path, "utf8").catch(() => "[]");
	const parsed = JSON.parse(raw) as unknown;
	if (!Array.isArray(parsed)) return [];
	// soft guard to ensure shape
	const out: StoreDoc[] = [];
	for (const it of parsed) {
		if (
			typeof it === "object" &&
			it !== null &&
			"meta" in (it as Record<string, unknown>) &&
			typeof (it as StoreDoc).meta?.filePath === "string" &&
			typeof (it as StoreDoc).text === "string"
		) {
			out.push(it as StoreDoc);
		}
	}
	return out;
}

/* ────────────── repo signals ────────────── */

type RepoSignals = {
	files: string[];
	filesSet: Set<string>;
	hasReadme?: string;
	hasContributing?: string;
	hasChangelog?: string;
	hasLicense?: string;
	hasDockerfile?: string;
	docsDirs: string[]; // e.g. ["docs/"]
	monorepoRoots: string[]; // e.g. ["packages/", "apps/", "services/"]
	langs: Set<
		"python" | "node" | "go" | "rust" | "java" | "dotnet" | "swift" | "php"
	>;
	langConfigs: string[]; // matched config files (pyproject.toml, package.json, etc)
};

function detectRepoSignals(store: StoreDoc[]): RepoSignals {
	const files = store.map((d) => d.meta.filePath);
	const filesSet = new Set(files);

	const find = (re: RegExp): string | undefined => {
		for (const f of files) if (re.test(f)) return f;
		return undefined;
	};

	const hasReadme = find(/(^|\/)README\.md$/i);
	const hasContributing = find(/(^|\/)CONTRIBUTING\.md$/i);
	const hasChangelog = find(/(^|\/)CHANGELOG\.md$/i);
	const hasLicense = find(/(^|\/)LICENSE(\.|$)/i);
	const hasDockerfile = find(/(^|\/)Dockerfile$/);

	const docsDirs = uniq(
		files
			.filter((f) => /^docs\//i.test(f) || /\/docs\//i.test(f))
			.map((f) => f.replace(/(^|.*?\/docs\/).*/i, "$1"))
			.map((p) => (p.endsWith("/") ? p : `${p}/`)), // ensure trailing slash
	);

	const monoPrefixes = [
		"packages/",
		"apps/",
		"services/",
		"libs/",
		"examples/",
	];
	const monorepoRoots = uniq(
		files
			.map((f) => {
				for (const p of monoPrefixes) if (f.startsWith(p)) return p;
				const m = f.match(/^[^/]+\/[^/]+\//); // generic two-level root like "projects/foo/"
				return m ? m[0] : undefined;
			})
			.filter((v): v is string => typeof v === "string"),
	);

	const langs = new Set<
		"python" | "node" | "go" | "rust" | "java" | "dotnet" | "swift" | "php"
	>();
	const langConfigs: string[] = [];

	const pushIf = (re: RegExp, arr: string[]) => {
		const hit = find(re);
		if (hit) arr.push(hit);
		return hit;
	};

	// Python
	if (pushIf(/(^|\/)pyproject\.toml$/i, langConfigs)) langs.add("python");
	if (pushIf(/(^|\/)requirements\.(txt|in)$/i, langConfigs))
		langs.add("python");
	if (pushIf(/(^|\/)setup\.cfg$/i, langConfigs)) langs.add("python");

	// Node/TS
	if (pushIf(/(^|\/)package\.json$/i, langConfigs)) langs.add("node");
	pushIf(/(^|\/)pnpm-workspace\.yaml$/i, langConfigs);
	pushIf(/(^|\/)yarn\.lock$/i, langConfigs);
	pushIf(/(^|\/)tsconfig\.json$/i, langConfigs);

	// Go
	if (pushIf(/(^|\/)go\.mod$/i, langConfigs)) langs.add("go");

	// Rust
	if (pushIf(/(^|\/)Cargo\.toml$/i, langConfigs)) langs.add("rust");

	// Java
	if (
		pushIf(/(^|\/)pom\.xml$/i, langConfigs) ||
		pushIf(/(^|\/)build\.gradle$/i, langConfigs)
	)
		langs.add("java");

	// .NET
	if (pushIf(/\.csproj$/i, langConfigs)) langs.add("dotnet");

	// Swift
	if (pushIf(/(^|\/)Package\.swift$/i, langConfigs)) langs.add("swift");

	// PHP
	if (pushIf(/(^|\/)composer\.json$/i, langConfigs)) langs.add("php");

	return {
		files,
		filesSet,
		hasReadme,
		hasContributing,
		hasChangelog,
		hasLicense,
		hasDockerfile,
		docsDirs,
		monorepoRoots,
		langs,
		langConfigs,
	};
}

/* ────────────── minimal backfill (no embeddings) ────────────── */

function pickFirstMatching(files: string[], patterns: RegExp[]): string[] {
	const out: string[] = [];
	for (const re of patterns) {
		const hit = files.find((f) => re.test(f));
		if (hit && !out.includes(hit)) out.push(hit);
	}
	return out;
}

function suggestFilesForPage(
	title: string,
	sig: RepoSignals,
	cap: number,
): string[] {
	const t = title.toLowerCase();

	// Common candidates per topic (language-aware when possible)
	const any: RegExp[] = [];
	if (sig.hasReadme) any.push(/(^|\/)README\.md$/i);
	if (sig.docsDirs.length) any.push(/^docs\//i);

	const setup: RegExp[] = [
		/(^|\/)README\.md$/i,
		/(^|\/)docs\/.*install/i,
		/(^|\/)docs\/.*setup/i,
		/(^|\/)Dockerfile$/i,
	];
	if (sig.langs.has("python"))
		setup.push(
			/(^|\/)pyproject\.toml$/i,
			/(^|\/)requirements\.(txt|in)$/i,
			/(^|\/)setup\.cfg$/i,
		);
	if (sig.langs.has("node"))
		setup.push(
			/(^|\/)package\.json$/i,
			/(^|\/)tsconfig\.json$/i,
			/(^|\/)pnpm-workspace\.yaml$/i,
		);
	if (sig.langs.has("go")) setup.push(/(^|\/)go\.mod$/i);
	if (sig.langs.has("rust")) setup.push(/(^|\/)Cargo\.toml$/i);
	if (sig.langs.has("java")) setup.push(/(^|\/)(pom\.xml|build\.gradle)$/i);
	if (sig.langs.has("dotnet")) setup.push(/\.csproj$/i);
	if (sig.langs.has("swift")) setup.push(/(^|\/)Package\.swift$/i);
	if (sig.langs.has("php")) setup.push(/(^|\/)composer\.json$/i);

	const usage: RegExp[] = [
		/(^|\/)README\.md$/i,
		/(^|\/)docs\/.*usage/i,
		/(^|\/)docs\/.*example/i,
		/(^|\/)bin\/|(^|\/)scripts\//i,
	];

	const configuration: RegExp[] = [
		/(^|\/)config\.(js|ts|py|yml|yaml|json)$/i,
		/(^|\/)docs\/.*config/i,
		/(^|\/)pyproject\.toml$/i,
		/(^|\/)package\.json$/i,
	];

	const testing: RegExp[] = [
		/^tests?\//i,
		/(^|\/)docs\/.*test/i,
		/(^|\/)pytest\.ini$/i,
		/(^|\/)jest\.config\.(js|ts)$/i,
	];

	const architecture: RegExp[] = [
		/(^|\/)docs\/.*architecture/i,
		/(^|\/)integration\.py$/i,
		/(^|\/)src\/|(^|\/)lib\//i,
	];

	const dataFlow: RegExp[] = [
		/(^|\/)docs\/.*(flow|pipeline|design)/i,
		/(^|\/)handlers\/default_handler\.py$/i,
	];

	const contributing: RegExp[] = [/(^|\/)CONTRIBUTING\.md$/i];

	const troubleshooting: RegExp[] = [
		/(^|\/)docs\/.*troubleshooting/i,
		/(^|\/)docs\/.*faq/i,
		/(^|\/)README\.md$/i,
	];

	const releaseNotes: RegExp[] = [
		/(^|\/)CHANGELOG\.md$/i,
		/(^|\/)docs\/.*changelog/i,
	];

	// Basic routing (loose & additive)
	let patterns: RegExp[] = [];
	if (/setup|install|getting\s*started/.test(t))
		patterns = patterns.concat(setup);
	if (/usage|example|tutorial|cli/.test(t)) patterns = patterns.concat(usage);
	if (/config|configuration|settings/.test(t))
		patterns = patterns.concat(configuration);
	if (/test|testing|qa/.test(t)) patterns = patterns.concat(testing);
	if (/arch|design/.test(t)) patterns = patterns.concat(architecture);
	if (/data\s*flow|pipeline|state/.test(t))
		patterns = patterns.concat(dataFlow);
	if (/contrib/.test(t)) patterns = patterns.concat(contributing);
	if (/troubleshooting|faq/.test(t))
		patterns = patterns.concat(troubleshooting);
	if (/release|changelog/.test(t)) patterns = patterns.concat(releaseNotes);

	// Always allow “any” as tail fallback
	patterns = patterns.concat(any);

	const picks = uniq(pickFirstMatching(sig.files, patterns)).slice(0, cap);

	// Monorepo nudge (keep files within one root if we can)
	if (sig.monorepoRoots.length > 0 && picks.length > 1) {
		const root = sig.monorepoRoots.find((r) =>
			picks.some((f) => f.startsWith(r)),
		);
		if (root) {
			const prefer = picks.filter((f) => f.startsWith(root));
			const rest = picks.filter((f) => !f.startsWith(root));
			return [...prefer, ...rest].slice(0, cap);
		}
	}

	return picks;
}

/* ────────────── main step ────────────── */

export function stepRepairWiki(options?: {
	maxFilesPerPage?: number;
	fillDescriptions?: boolean; // one-liner LLM pass (optional)
	descModel?: string;
}): Step<WikiOutput, WikiOutput> {
	const {
		maxFilesPerPage = 4,
		fillDescriptions = false,
		descModel: _descModel,
	} = options ?? {};

	return (log) => async (doc) => {
		const storeDocs = await loadStore(doc.storePath);
		if (storeDocs.length === 0) {
			log.warn?.("repairWiki: no store docs found; returning as-is.");
			return doc;
		}
		const sig = detectRepoSignals(storeDocs);

		// 1) prune ToC-like pages and normalise ids (cheap, deterministic)
		let pages = doc.wiki.pages.filter((p) => !looksLikeTOC(p.title));
		pages = pages.map((p) => {
			const id = p.id?.trim() ? slugify(p.id) : slugify(p.title);
			const files = Array.isArray(p.relevant_files)
				? p.relevant_files.filter((f) => typeof f === "string")
				: [];
			return { ...p, id, relevant_files: files };
		});

		// 2) ensure relevant_files exist; if empty, gently backfill from signals (no embeddings)
		for (const p of pages) {
			const current = Array.isArray(p.relevant_files) ? p.relevant_files : [];
			if (current.length === 0) {
				const picks = suggestFilesForPage(p.title, sig, maxFilesPerPage);
				p.relevant_files = picks.length
					? picks
					: sig.hasReadme
						? [sig.hasReadme]
						: [];
			} else {
				// clamp & keep only known files
				p.relevant_files = uniq(
					current.filter((f) => sig.filesSet.has(f)),
				).slice(0, maxFilesPerPage);
			}
		}

		// 3) optional single-line descriptions (tiny model hit; safe to skip)
		if (fillDescriptions) {
			// Custom check to force a clean single sentence (no JSON, no code)
			const _checkLine = (out: string) => {
				if (typeof out !== "string") return false;
				const s = out.trim();
				if (!s) return false;
				if (s.length > 220) return false;
				if (/^[{[]/.test(s)) return false; // looks like JSON
				if (/```/.test(s)) return false; // code fence
				if (s.split("\n").length > 2) return false;
				return s;
			};

			for (const p of pages) {
				if (p.description?.trim()) continue;
				const filesHint = p.relevant_files?.slice(0, 2).join(", ");
				const system = `Reply with a single concise sentence. No preamble. No JSON. No code fences. Respond in ${doc.languageName}.`;
				const user = `One-line description for wiki page "${p.title}". Relevant files: ${filesHint || "N/A"}`;
				try {
					const line = await gen(`${system} ${user}`);
					// light cleanup after a "good" check
					const cleaned = line
						.replace(/^\s*["'`]|["'`]\s*$/g, "")
						.replace(/\s+/g, " ")
						.trim();
					if (cleaned) p.description = cleaned;
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					log.warn?.(`desc gen failed for "${p.title}": ${msg}`);
				}
			}
		}

		// 4) sections: keep only existing page ids; slugify section ids; drop empties
		const pageIds = new Set(pages.map((p) => p.id));
		const sections = (doc.wiki.sections ?? [])
			.map((s) => ({
				...s,
				id: s.id?.trim() ? slugify(s.id) : slugify(s.title),
				pages: (s.pages ?? []).filter((pid) => pageIds.has(pid)),
				subsections:
					s.subsections?.filter((x) => typeof x === "string") ?? undefined,
			}))
			.filter((s) => (s.pages?.length ?? 0) > 0);

		const fixed: WikiOutput = {
			...doc,
			wiki: {
				...doc.wiki,
				pages,
				sections,
			},
		};

		// report
		const stillEmpty = pages.filter(
			(p) => (p.relevant_files?.length ?? 0) === 0,
		);
		if (stillEmpty.length) {
			log.warn?.(
				`Pages still without relevant_files: ${stillEmpty.map((p) => p.title).join(", ")}`,
			);
		} else {
			log.info?.("repairWiki: all pages have non-empty relevant_files ✓");
		}

		return fixed;
	};
}
