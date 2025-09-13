// src/features/wiki/steps/autoExtracts.ts
import type {
	DraftsEnrichedOutput,
	DraftsOutput,
	PageContext,
	PageDraft,
	PipelineStep,
} from "../types.ts";

function insertUnderSection(
	md: string,
	section: string,
	block: string,
): string {
	const safe = md ?? "";
	const re = new RegExp(
		`(^|\\n)##\\s*${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\n`,
		"i",
	);
	const m = safe.match(re);
	if (!m || m.index == null) return `${safe}\n\n${block}\n`;
	const idx = m.index + m[0].length;
	return `${safe.slice(0, idx)}\n${block}\n${safe.slice(idx)}`;
}

function extractDepsFromPyproject(
	text: string,
): Array<{ name: string; purpose?: string }> {
	const rows: Array<{ name: string; purpose?: string }> = [];
	const t = text || "";
	const inDepsScope =
		/\[project\.dependencies\]|\[tool\.poetry\.dependencies\]/i.test(t);
	const scope = inDepsScope ? t : "";
	const re = /["']?([a-zA-Z0-9_.-]+)["']?\s*=\s*["']?([^"'\n]+)["']?/g;
	for (const m of scope.matchAll(re)) rows.push({ name: m[1] });
	if (rows.length === 0) {
		const reList = /^\s*-\s*([a-zA-Z0-9_.-]+)\b.*$/gm;
		for (const m of t.matchAll(reList)) rows.push({ name: m[1] });
	}
	return rows.slice(0, 20);
}

function extractConfigPairs(
	text: string,
): Array<{ key: string; def?: string; note?: string }> {
	const out: Array<{ key: string; def?: string; note?: string }> = [];
	const t = text || "";
	const reEnv = /^\s*([A-Z0-9_]{2,})\s*=\s*([^\s#]+)?/gm;
	for (const m of t.matchAll(reEnv)) out.push({ key: m[1], def: m[2] });
	const rePy = /^\s*([A-Z0-9_]{2,})\s*=\s*([^\n#]+?)(?:\s*#\s*(.+))?$/gm;
	for (const m of t.matchAll(rePy))
		out.push({ key: m[1], def: m[2]?.trim(), note: m[3]?.trim() });
	return out.slice(0, 50);
}

function extractCliOptions(
	text: string,
): Array<{ flag: string; type?: string; def?: string; desc?: string }> {
	const out: Array<{
		flag: string;
		type?: string;
		def?: string;
		desc?: string;
	}> = [];
	const re = /(--[a-z0-9][a-z0-9-]*)(?:\s*[=:]\s*([A-Z<[][^\s)]*))?/gi;
	for (const m of (text || "").matchAll(re))
		out.push({ flag: m[1], type: m[2] });
	return out.slice(0, 40);
}

function table<T extends object>(
	headers: string[],
	rows: T[],
	pick: (r: T) => string[],
): string {
	if (rows.length === 0) return "";
	const head = `|${headers.join("|")}|\n|${headers.map(() => "-").join("|")}|`;
	const body = rows
		.map(
			(r) =>
				`|${pick(r)
					.map((c) => (c ?? "").toString().trim())
					.join("|")}|`,
		)
		.join("\n");
	return `${head}\n${body}`;
}

export function stepAutoExtracts(): PipelineStep<
	DraftsOutput,
	DraftsEnrichedOutput
> {
	return () => async (doc) => {
		const ctxById = new Map<string, PageContext>(
			doc.pagesContext.map((p) => [p.pageId, p]),
		);
		const enriched: PageDraft[] = [];

		for (const d of doc.drafts) {
			const pc = ctxById.get(d.pageId);
			if (!pc) {
				enriched.push(d);
				continue;
			}

			let md = d.markdown ?? ""; // <— guard
			const ctx = pc.context || "";

			if (/^#\s*(overview|setup|getting started)/i.test(md)) {
				const deps = extractDepsFromPyproject(ctx);
				if (deps.length) {
					const block = `\n**Dependencies**\n\n${table(["Dependency", "Purpose"], deps, (r) => [r.name, r.purpose ?? ""])}\n`;
					md = insertUnderSection(md, "Installation and Requirements", block);
				}
			}

			if (
				/^#\s*configuration/i.test(md) ||
				/##\s*Keys\s*&\s*Defaults/i.test(md)
			) {
				const cfg = extractConfigPairs(ctx);
				if (cfg.length) {
					const block = `\n**Configuration keys**\n\n${table(["Key", "Default", "Note"], cfg, (r) => [r.key, r.def ?? "", r.note ?? ""])}\n`;
					md = insertUnderSection(md, "Keys & Defaults", block);
				}
			}

			const cli = extractCliOptions(ctx);
			if (cli.length && /#\s*(setup|getting started|overview)/i.test(md)) {
				const block = `\n**Common command-line options**\n\n${table(["Flag", "Type", "Default", "Description"], cli, (r) => [r.flag, r.type ?? "", r.def ?? "", r.desc ?? ""])}\n`;
				md = insertUnderSection(md, "Basic Usage", block);
			}

			enriched.push({ ...d, markdown: md });
		}

		return { ...doc, drafts: enriched };
	};
}
