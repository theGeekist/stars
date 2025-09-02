import { OllamaService } from "@jasonnathan/llm-core";
import { gen as realGen } from "@lib/ollama";
import {
	chunkMarkdown,
	cleanMarkdown,
	fetchReadmeWithCache,
} from "@lib/readme";
import {
	cosine,
	enforceWordCap,
	isAwesomeList,
	linkDensity,
	summariseAwesomeList,
} from "@lib/utils";
import prompts from "../../../prompts.yaml";
import type { Meta } from "./types";

export type SummariseDeps = {
	gen?: (prompt: string, opts?: Record<string, unknown>) => Promise<string>;
	embed?: { embedTexts: (texts: string[]) => Promise<number[][]> };
};

export async function summariseRepoOneParagraph(
	meta: Meta,
	deps?: SummariseDeps,
): Promise<string> {
	const baseHints = [
		meta.description ?? "",
		meta.primaryLanguage ? `Primary language: ${meta.primaryLanguage}` : "",
		meta.topics?.length ? `Topics: ${meta.topics.join(", ")}` : "",
		meta.metrics
			? `Signals: popularity=${meta.metrics.popularity ?? 0}, freshness=${meta.metrics.freshness ?? 0}, activeness=${meta.metrics.activeness ?? 0}`
			: "",
	]
		.filter(Boolean)
		.join(" | ");

	let awesome = isAwesomeList(
		meta.nameWithOwner,
		meta.description,
		meta.topics,
	);

	let clean = "";
	let chunks: string[] = [];
	if (!awesome) {
		const raw = await fetchReadmeWithCache(
			meta.repoId ?? 0,
			meta.nameWithOwner,
		);
		if (raw) {
			clean = cleanMarkdown(raw);
			const firstLine = clean.split(/\r?\n/).find((l) => l.trim().length > 0);
			if (
				isAwesomeList(
					meta.nameWithOwner,
					meta.description,
					meta.topics,
					firstLine,
				)
			) {
				awesome = true;
			} else {
				chunks = chunkMarkdown(clean, {
					chunkSizeTokens: 768,
					chunkOverlapTokens: 80,
					mode: "sentence",
				});
			}
		}
	}

	if (awesome) return summariseAwesomeList(meta.description, meta.topics);

	const gen = deps?.gen ?? realGen;
	if (chunks.length === 0) {
		const header =
			(prompts?.summarise?.one_paragraph as string) ??
			`Write ONE paragraph (<=100 words) that summarises the project for an experienced engineer.\nInclude purpose, core tech, standout capability, maturity signal (if any), ideal use case.\nNo bullet points or headings or em dashes. Neutral tone. Do not invent facts.\nYour summary must stand the test of time; do not mention scores.`;
		const prompt = `
${header}

Project: ${meta.nameWithOwner}
URL: ${meta.url}
Hints: ${baseHints || "(none)"}
`.trim();
		const p = await gen(prompt, { temperature: 0.2 });
		return enforceWordCap(p, 100);
	}

	const LARGE_README_CHARS = 25_000;
	let picked = chunks;

	if (clean.length >= LARGE_README_CHARS && chunks.length > 6) {
		const svc = deps?.embed ?? new OllamaService("all-minilm:l6-v2");
		const query =
			"what is this project, its core purpose, technical approach, and standout capability";
		const [qv] = await svc.embedTexts([query]);
		const cvs = await svc.embedTexts(chunks);
		const scored = cvs.map((v, i) => ({
			t: chunks[i],
			s: cosine(v, qv) - linkDensity(chunks[i]) * 0.2,
		}));
		picked = scored
			.sort((a, b) => b.s - a.s)
			.slice(0, 8)
			.map((x) => x.t);
	} else {
		picked = chunks.filter((t) => linkDensity(t) < 0.4).slice(0, 12);
		if (picked.length === 0) picked = chunks.slice(0, 8);
	}

	const mapHeader = (
		(prompts?.summarise?.map_header as string) ??
		`From the following text, extract 2-3 concise bullets (10-18 words each), no fluff.\nFocus on: purpose, core tech/architecture, standout capabilities, maturity signals (derive only if stated).\nReturn only bullets prefixed with "- ".`
	).trim();

	const bullets: string[] = [];
	const MAX_MAP_CHARS = 7000;
	let used = 0;

	for (const chunk of picked) {
		if (used > MAX_MAP_CHARS) break;
		const resp = await gen(`${mapHeader}\n\n${chunk}`, { temperature: 0.2 });
		const lines = resp
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.startsWith("- "))
			.slice(0, 3);
		bullets.push(...lines);
		used += chunk.length;
		if (bullets.length >= 18) break;
	}

	if (baseHints) bullets.push(`- ${baseHints}`);

	const reduceHeader =
		(prompts?.summarise?.reduce as string) ??
		`Write ONE paragraph (≤100 words) for the general public.\nInclude: purpose, core tech/approach, one standout capability, maturity signal (if present), ideal use case.\nNo marketing language. Present tense. If something isn’t in the notes, omit, do not guess. No em dashes.\nReturn only the paragraph. Do not mention numeric scores.`;
	const reducePrompt = `
${reduceHeader}

Bullets:
${bullets.join("\n")}
`.trim();

	const paragraph = await gen(reducePrompt, { temperature: 0.2 });
	return enforceWordCap(paragraph, 100);
}
