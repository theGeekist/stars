// src/features/wiki/steps/polishWiki.ts

import { readFile } from "node:fs/promises";
import { OllamaService } from "@jasonnathan/llm-core";
import type { PipelineStep, StoreDoc, WikiOutput } from "../types";
import { slugify } from "@lib/utils";
import { uniq, isNumArray, basename } from "../utils";

function existsInStore(files: string[], store: StoreDoc[]) {
	const set = new Set(store.map((d) => d.meta.filePath));
	return files.filter((f) => set.has(f));
}
async function loadStore(path: string): Promise<StoreDoc[]> {
	try {
		const raw = await readFile(path, "utf8");
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? (arr as StoreDoc[]) : [];
	} catch {
		return [];
	}
}
function cos(a: number[], b: number[]) {
	let dot = 0,
		na = 0,
		nb = 0;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const x = a[i],
			y = b[i];
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/* ----------------------- signals + rules (agnostic) ----------------------- */

type Language =
	| "python"
	| "node"
	| "go"
	| "rust"
	| "java"
	| "dotnet"
	| "swift"
	| "php";

type RepoSignals = {
	files: string[];
	hasReadme?: string;
	hasContrib?: string;
	hasChangelog?: string;
	langs: Set<Language>;
	isMonorepo: boolean;
	// lightweight entrypoint hints
	cliHints: string[]; // bin/, __main__.py, cmd/, src/main.rs, etc.
	configHints: string[]; // pyproject.toml, package.json, go.mod, Cargo.toml, etc.
};

function detectSignals(store: StoreDoc[]): RepoSignals {
	const files = store.map((d) => d.meta.filePath);

	const findOne = (re: RegExp) => {
		for (const f of files) if (re.test(f)) return f;
		return undefined;
	};

	const hasReadme = findOne(/(^|\/)README\.md$/i);
	const hasContrib = findOne(/(^|\/)CONTRIBUTING\.md$/i);
	const hasChangelog = findOne(/(^|\/)CHANGELOG\.md$/i);

	const langs: Set<Language> = new Set();
	if (
		files.some((f) =>
			/(^|\/)pyproject\.toml$|requirements\.(txt|in)$|setup\.cfg$/i.test(f),
		)
	)
		langs.add("python");
	if (files.some((f) => /(^|\/)package\.json$|(^|\/)tsconfig\.json$/i.test(f)))
		langs.add("node");
	if (files.some((f) => /(^|\/)go\.mod$/i.test(f))) langs.add("go");
	if (files.some((f) => /(^|\/)Cargo\.toml$/i.test(f))) langs.add("rust");
	if (files.some((f) => /(^|\/)(pom\.xml|build\.gradle)$/i.test(f)))
		langs.add("java");
	if (files.some((f) => /\.csproj$/i.test(f))) langs.add("dotnet");
	if (files.some((f) => /(^|\/)Package\.swift$/i.test(f))) langs.add("swift");
	if (files.some((f) => /(^|\/)composer\.json$/i.test(f))) langs.add("php");

	const isMonorepo = files.some((f) =>
		/^packages\/|^apps\/|^services\/|(^|\/)pnpm-workspace\.yaml$|(^|\/)lerna\.json$|(^|\/)turbo\.json$/i.test(
			f,
		),
	);

	const cliHints: string[] = [];
	for (const f of files) {
		if (
			/(^|\/)__main__\.py$/i.test(f) ||
			/(^|\/)bin\/.+/.test(f) ||
			/(^|\/)cmd\/[^/]+\/main\.go$/i.test(f) ||
			/(^|\/)src\/main\.rs$/i.test(f) ||
			/(^|\/)src\/cli\.(js|ts|py)$/i.test(f) ||
			/(^|\/)handlers\/chat_handler\.py$/i.test(f)
		)
			cliHints.push(f);
	}

	const configHints: string[] = [];
	for (const f of files) {
		if (
			/(^|\/)pyproject\.toml$|(^|\/)requirements\.(txt|in)$|(^|\/)setup\.cfg$/i.test(
				f,
			) ||
			/(^|\/)package\.json$|(^|\/)tsconfig\.json$/i.test(f) ||
			/(^|\/)go\.mod$/i.test(f) ||
			/(^|\/)Cargo\.toml$/i.test(f) ||
			/(^|\/)(pom\.xml|build\.gradle)$/i.test(f) ||
			/\.csproj$/i.test(f) ||
			/(^|\/)Package\.swift$/i.test(f) ||
			/(^|\/)composer\.json$/i.test(f) ||
			/(^|\/)Dockerfile$/i.test(f)
		)
			configHints.push(f);
	}

	return {
		files,
		hasReadme,
		hasContrib,
		hasChangelog,
		langs,
		isMonorepo,
		cliHints: uniq(cliHints),
		configHints: uniq(configHints),
	};
}

type BoostRule = { re: RegExp; w: number };

function buildPageRules(
	pageKey: string,
	sig: RepoSignals,
): { negative: RegExp[]; boost: BoostRule[] } {
	const negative: RegExp[] = []; // default allow-all; add generic test exclusion per-topic below
	const boost: BoostRule[] = [];

	// default: keep tests out unless page is explicitly testing
	if (!/testing/.test(pageKey)) negative.push(/^tests?\//i);

	// language-aware config boosts (install/setup/usage/config)
	if (/(installation|setup|usage|configuration|key_features)/.test(pageKey)) {
		for (const path of sig.configHints) {
			// weight by file kind
			let w = 0.05;
			if (
				/pyproject\.toml$|package\.json$|go\.mod$|Cargo\.toml$|pom\.xml$|build\.gradle$|\.csproj$|Package\.swift$|composer\.json$/i.test(
					path,
				)
			)
				w = 0.08;
			if (/Dockerfile$/i.test(path)) w = Math.max(w, 0.06);
			boost.push({
				re: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
				w,
			});
		}
	}

	// usage/cli: prefer entrypoints
	if (/(usage|cli)/.test(pageKey)) {
		for (const path of sig.cliHints)
			boost.push({
				re: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
				w: 0.08,
			});
		if (typeof sig.hasReadme === "string")
			boost.push({ re: /(^|\/)README\.md$/i, w: 0.04 });
	}

	// configuration specifics
	if (/configuration/.test(pageKey)) {
		boost.push({ re: /(^|\/)config\.(js|ts|py|ya?ml|json)$/i, w: 0.1 });
		boost.push({ re: /(^|\/)\.env(\.example)?$/i, w: 0.05 });
	}

	// testing
	if (/testing/.test(pageKey)) {
		boost.push({ re: /^tests?\//i, w: 0.12 });
	}

	// contributing
	if (/contribution/.test(pageKey) && typeof sig.hasContrib === "string") {
		boost.push({ re: /(^|\/)CONTRIBUTING\.md$/i, w: 0.12 });
	}

	// release notes
	if (
		/(release|changelog)/.test(pageKey) &&
		typeof sig.hasChangelog === "string"
	) {
		boost.push({ re: /(^|\/)CHANGELOG\.md$/i, w: 0.18 });
	}

	// architecture/data_flow
	if (/(architecture|data_flow|design)/.test(pageKey)) {
		boost.push({ re: /(^|\/)(src|lib|internal|cmd)\//i, w: 0.06 });
	}

	return { negative, boost };
}

function topicQueries(title: string): string[] {
	const t = title.toLowerCase();
	const qs = [title];
	if (/install|setup|getting\s*started/.test(t))
		qs.push("install setup quickstart requirements");
	if (/architecture|design/.test(t))
		qs.push("architecture core modules overview main entrypoints config");
	if (/data\s*flow|pipeline|state/.test(t))
		qs.push("data flow request handling pipeline handlers events state");
	if (/usage|examples|cli/.test(t))
		qs.push("usage examples cli commands options");
	if (/contributing|development|testing/.test(t))
		qs.push("contributing development testing guidelines");
	if (/release|changelog/.test(t)) qs.push("changelog release notes changes");
	if (/faq|troubleshooting/.test(t))
		qs.push("troubleshooting common issues error");
	if (/api|reference/.test(t))
		qs.push("api reference functions classes public interface");
	return uniq(qs);
}

type Scored = { file: string; score: number };

function rankFilesByQuery(
	store: StoreDoc[],
	qv: number[],
	usedPenalty: Map<string, number>,
	pageKey: string,
	sig: RepoSignals,
): Scored[] {
	const { negative, boost } = buildPageRules(pageKey, sig);

	const scored: Scored[] = [];
	for (const d of store) {
		if (!isNumArray(d.embedding)) continue;
		const file = d.meta.filePath;
		if (negative.some((re) => re.test(file))) continue;

		const base = cos(d.embedding, qv);
		const pen = usedPenalty.get(file) ?? 0;
		let add = 0;
		for (const r of boost) if (r.re.test(file)) add += r.w;

		scored.push({ file, score: base + add - pen });
	}

	scored.sort((a, b) => b.score - a.score);
	const seen = new Set<string>();
	const out: Scored[] = [];
	for (const r of scored) {
		if (!seen.has(r.file)) {
			seen.add(r.file);
			out.push(r);
		}
	}
	return out;
}

/* ------------------------------- main step ------------------------------- */

export function stepPolishWiki(options: {
	embedModel: string;
	maxFilesPerPage?: number;
	minFilesPerPage?: number;
	maxRelated?: number;
	readmePenalty?: number;
	maxReadmeGlobal?: number;
}): PipelineStep<WikiOutput, WikiOutput> {
	const {
		embedModel,
		maxFilesPerPage = 4,
		minFilesPerPage = 2,
		maxRelated = 5,
		readmePenalty = 0.08,
		maxReadmeGlobal = 2,
	} = options ?? {};

	return (log) => async (doc) => {
		const store = await loadStore(doc.storePath);
		if (store.length === 0) {
			log.warn?.("No store docs; skipping polish step.");
			return doc;
		}

		const svc = new OllamaService(embedModel);
		const sig = detectSignals(store);

		// helpers using detected signals (close over `sig`)
		const pageDisallowed = (pageKey: string, filePath: string) =>
			buildPageRules(pageKey, sig).negative.some((re) => re.test(filePath));

		const pageBoostVal = (pageKey: string, filePath: string) => {
			const rules = buildPageRules(pageKey, sig).boost;
			let add = 0;
			for (const r of rules) if (r.re.test(filePath)) add += r.w;
			return add;
		};

		const allFiles = new Set(store.map((d) => d.meta.filePath));
		const findByBasename = (name: string) => {
			const lname = name.toLowerCase();
			for (const f of allFiles)
				if (basename(f).toLowerCase() === lname) return f;
			return undefined;
		};

		const preferred = {
			changelog: sig.hasChangelog ?? findByBasename("CHANGELOG.md"),
			readme: sig.hasReadme ?? findByBasename("README.md"),
			contrib: sig.hasContrib ?? findByBasename("CONTRIBUTING.md"),
			cli: ((): string | undefined => {
				for (const hint of sig.cliHints) if (allFiles.has(hint)) return hint;
				return undefined;
			})(),
		};

		// frequency penalty discourages over-use across pages
		const usedPenalty = new Map<string, number>();
		const bump = (f: string, w = 1) => {
			usedPenalty.set(f, (usedPenalty.get(f) ?? 0) + w);
		};

		// gently penalise README/CONTRIBUTING globally
		if (typeof preferred.readme === "string")
			bump(preferred.readme, readmePenalty);
		if (typeof preferred.contrib === "string")
			bump(preferred.contrib, readmePenalty);

		const fileUseCount = new Map<string, number>();
		const incUse = (f: string) => {
			fileUseCount.set(f, (fileUseCount.get(f) ?? 0) + 1);
		};
		const canUseReadme = () => {
			if (typeof preferred.readme !== "string") return false;
			return (fileUseCount.get(preferred.readme) ?? 0) < maxReadmeGlobal;
		};

		for (const p of doc.wiki.pages) {
			const pageKey = slugify(p.id || p.title);

			// strong one-file overrides
			if (
				/(release|changelog)/i.test(p.title) &&
				typeof preferred.changelog === "string"
			) {
				p.relevant_files = [preferred.changelog];
				bump(preferred.changelog, 0.06);
				incUse(preferred.changelog);
				continue;
			}

			// seed with page-appropriate hints
			const hints: string[] = [];
			if (/(usage|cli)/i.test(p.title)) {
				if (typeof preferred.cli === "string") hints.push(preferred.cli);
				else if (typeof preferred.readme === "string")
					hints.push(preferred.readme);
			}
			if (
				/contributing/i.test(p.title) &&
				typeof preferred.contrib === "string"
			) {
				hints.push(preferred.contrib);
			}

			// start from existing picks, then add hints, then ranked
			let picks = uniq(Array.isArray(p.relevant_files) ? p.relevant_files : []);
			for (const h of hints) if (!picks.includes(h)) picks.push(h);

			const queries = topicQueries(p.title);
			// batch-embed for this page’s queries
			const qvecs = await svc.embedTexts(queries);

			for (let qi = 0; qi < qvecs.length; qi++) {
				const qv = qvecs[qi];
				if (!isNumArray(qv)) continue;

				const ranked = rankFilesByQuery(store, qv, usedPenalty, pageKey, sig);
				for (const r of ranked) {
					if (picks.length >= maxFilesPerPage) break;
					if (picks.includes(r.file)) continue;
					if (pageDisallowed(pageKey, r.file)) continue;

					if (basename(r.file).toLowerCase() === "readme.md" && !canUseReadme())
						continue;

					// keep contrib out of install/setup/key-features/usage/config/debugging
					if (
						/CONTRIBUTING\.md$/i.test(r.file) &&
						/(install|setup|key_features|usage|configuration|debugging)/.test(
							pageKey,
						)
					)
						continue;

					// optional extra: small nudge for dynamically computed boost (already applied in ranking but harmless to check)
					void pageBoostVal(pageKey, r.file);

					picks.push(r.file);
				}
				if (picks.length >= maxFilesPerPage) break;
			}

			// final existence + cap + minimum
			picks = existsInStore(picks, store).filter(
				(f) => !pageDisallowed(pageKey, f),
			);

			if (!canUseReadme()) {
				picks = picks.filter((f) => basename(f).toLowerCase() !== "readme.md");
			}

			// ensure minimum (try next-best by first query if needed)
			if (
				picks.length < minFilesPerPage &&
				qvecs.length > 0 &&
				isNumArray(qvecs[0])
			) {
				const backfill = rankFilesByQuery(
					store,
					qvecs[0],
					usedPenalty,
					pageKey,
					sig,
				)
					.map((r) => r.file)
					.filter((f) => !picks.includes(f) && !pageDisallowed(pageKey, f));
				// still respect global README cap during backfill
				const finalBackfill: string[] = [];
				for (const f of backfill) {
					if (basename(f).toLowerCase() === "readme.md" && !canUseReadme())
						continue;
					finalBackfill.push(f);
					if (picks.length + finalBackfill.length >= minFilesPerPage) break;
				}
				picks = uniq([...picks, ...finalBackfill]);
			}

			p.relevant_files = picks.slice(
				0,
				Math.max(maxFilesPerPage, minFilesPerPage),
			);

			for (const f of p.relevant_files) {
				bump(f, 0.03);
				incUse(f);
			}
		}

		// symmetric, bounded related_pages
		const byId = new Map<string, (typeof doc.wiki.pages)[number]>(
			doc.wiki.pages.map((page) => [page.id, page]),
		);
		for (const p of doc.wiki.pages) {
			const rel = new Set<string>(
				Array.isArray(p.related_pages) ? p.related_pages : [],
			);
			const relArr = Array.from(rel);
			for (const r of relArr) {
				const other = byId.get(r);
				if (!other) {
					rel.delete(r);
					continue;
				}
				const otherSet = new Set<string>(
					Array.isArray(other.related_pages) ? other.related_pages : [],
				);
				if (!otherSet.has(p.id)) {
					otherSet.add(p.id);
					other.related_pages = Array.from(otherSet).slice(0, maxRelated);
				}
			}
			p.related_pages = Array.from(rel).slice(0, maxRelated);
		}

		// report
		const empty = doc.wiki.pages.filter(
			(pg) =>
				!Array.isArray(pg.relevant_files) || pg.relevant_files.length === 0,
		);
		if (empty.length > 0)
			log.warn?.(
				`Pages with no files after polish: ${empty.map((pg) => pg.title).join(", ")}`,
			);
		else log.info?.("Polish complete: all pages have non-empty relevant_files");

		return doc;
	};
}
