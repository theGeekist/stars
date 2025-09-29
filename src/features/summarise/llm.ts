// src/features/summarise/llm.ts
import { createOllamaService } from "@jasonnathan/llm-core/ollama-service";
import { gen as realGen } from "@lib/ollama";
import { promptsConfig as prompts } from "@lib/prompts";
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
import type { Meta, SummariseDeps } from "./types";

function buildBaseHints(meta: Meta): string {
	const parts = [
		meta.description ?? "",
		meta.primaryLanguage ? `Primary language: ${meta.primaryLanguage}` : "",
		meta.topics?.length ? `Topics: ${meta.topics.join(", ")}` : "",
		meta.metrics
			? `Signals: popularity=${meta.metrics.popularity ?? 0}, freshness=${meta.metrics.freshness ?? 0}, activeness=${meta.metrics.activeness ?? 0}`
			: "",
	];
	return parts.filter(Boolean).join(" | ");
}

async function loadReadme(
	meta: Meta,
): Promise<{ clean: string; chunks: string[]; awesome: boolean; meta: Meta }> {
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
	return { clean, chunks, awesome, meta };
}

async function selectContentChunks(
	clean: string,
	chunks: string[],
	deps?: SummariseDeps,
): Promise<string[]> {
	const LARGE_README_CHARS = 25_000;
	if (clean.length >= LARGE_README_CHARS && chunks.length > 6) {
		const svc =
			deps?.embed ??
			createOllamaService({
				model: Bun.env.OLLAMA_EMBEDDING_MODEL ?? "",
				apiKey: Bun.env.OLLAMA_API_KEY ?? "",
				endpoint: Bun.env.OLLAMA_ENDPOINT ?? "",
			});
		const query =
			"what is this project, its core purpose, technical approach, and standout capability";
		const [qv] = await svc.embedTexts([query]);
		const cvs = await svc.embedTexts(chunks);
		const scored = cvs.map((v, i) => ({
			t: chunks[i],
			s: cosine(v, qv) - linkDensity(chunks[i]) * 0.2,
		}));
		return scored
			.sort((a, b) => b.s - a.s)
			.slice(0, 8)
			.map((x) => x.t);
	}
	const filtered = chunks.filter((t) => linkDensity(t) < 0.4).slice(0, 12);
	return filtered.length ? filtered : chunks.slice(0, 8);
}

async function generateFromMetadata(
	meta: Meta,
	baseHints: string,
	gen: (p: string, o?: Record<string, unknown>) => Promise<string>,
): Promise<string> {
	const prompt = `${prompts?.summarise?.one_paragraph}

Project: ${meta.nameWithOwner}
URL: ${meta.url}
Hints: ${baseHints || "(none)"}
`.trim();
	const p = await gen(prompt, { temperature: 0.2 });
	return enforceWordCap(p, 100);
}

async function mapChunksToBullets(
	picked: string[],
	gen: (p: string, o?: Record<string, unknown>) => Promise<string>,
): Promise<string[]> {
	const mapHeader = prompts?.summarise?.map_header;
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
	return bullets;
}

async function reduceBulletsToParagraph(
	bullets: string[],
	baseHints: string,
	gen: (p: string, o?: Record<string, unknown>) => Promise<string>,
): Promise<string> {
	if (baseHints) bullets.push(`- ${baseHints}`);
	const reducePrompt = `
${prompts?.summarise?.reduce}

Bullets:
${bullets.join("\n")}
`.trim();
	const paragraph = await gen(reducePrompt, { temperature: 0.2 });
	return enforceWordCap(paragraph, 100);
}

async function paraphraseAwesomeList(
	awesomeSummary: string,
	deps?: SummariseDeps,
): Promise<string> {
	const prompt =
		`Rephrase the following, saying the same thing in a slightly different way, just for variability:
${awesomeSummary}
`.trim();
	return deps?.gen
		? deps.gen(prompt, { temperature: 0.2 })
		: realGen(prompt, { temperature: 0.2 });
}

export async function summariseRepoOneParagraph(
	meta: Meta,
	deps?: SummariseDeps,
): Promise<string> {
	const baseHints = buildBaseHints(meta);
	const { clean, chunks, awesome } = await loadReadme(meta);
	if (awesome) {
		const awesomeSummary = summariseAwesomeList(meta.description, meta.topics);
		// Fast path: unless caller explicitly injects a generator, skip paraphrase to avoid network.
		if (!deps?.gen) return awesomeSummary;
		try {
			return await paraphraseAwesomeList(awesomeSummary, deps);
		} catch {
			return awesomeSummary;
		}
	}

	const gen = deps?.gen ?? realGen;
	if (chunks.length === 0) {
		const results = await generateFromMetadata(meta, baseHints, gen);
		// console.log("-".repeat(20));
		// console.log(results);
		// console.log("-".repeat(20));
		return results;
	}

	const picked = await selectContentChunks(clean, chunks, deps);
	// console.log({ picked });
	const bullets = await mapChunksToBullets(picked, gen);
	// console.log({ bullets });
	return reduceBulletsToParagraph(bullets, baseHints, gen);
}

/**
 * Summarise repo with separate gen functions for main steps and reduction.
 * @param meta Repo metadata
 * @param deps Optional dependencies
 * @param genMain Used for all steps except reduction
 * @param genReduce Used for reduceBulletsToParagraph
 */
export async function summariseRepoOneParagraphWithCustomGen(
	meta: Meta,
	deps: SummariseDeps | undefined,
	genMain: (p: string, o?: Record<string, unknown>) => Promise<string>,
	genReduce: (p: string, o?: Record<string, unknown>) => Promise<string>,
): Promise<string> {
	const baseHints = buildBaseHints(meta);
	const { clean, chunks, awesome } = await loadReadme(meta);
	if (awesome) {
		const awesomeSummary = summariseAwesomeList(meta.description, meta.topics);
		if (!deps?.gen) return awesomeSummary;
		try {
			return await paraphraseAwesomeList(awesomeSummary, deps);
		} catch {
			return awesomeSummary;
		}
	}
	if (chunks.length === 0)
		return generateFromMetadata(meta, baseHints, genMain);

	const picked = await selectContentChunks(clean, chunks, deps);
	const bullets = await mapChunksToBullets(picked, genMain);
	return reduceBulletsToParagraph(bullets, baseHints, genReduce);
}
