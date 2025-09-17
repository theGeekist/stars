// src/features/wiki/steps/chunk.ts
import { createOllamaService, markdownSplitter } from "@jasonnathan/llm-core";
import { cosineDropChunker } from "@lib/utils.js";
import type { ChunkOutput, Doc, ReadOutput, Step } from "../types.ts";

const tok = (s: string) => Math.max(1, Math.ceil(s.length / 4));

// --- heuristics --------------------------------------------------------------
const SMALL_TOKENS = 1024; // single-chunk threshold
const GREEDY_MAX = 4096; // fallback greedy: max tokens per chunk
const GREEDY_OVER = 200; // fallback greedy: overlap tokens

function greedyTokenChunks(
	text: string,
	maxT = GREEDY_MAX,
	overlapT = GREEDY_OVER,
): string[] {
	// Approximate by character windows scaled by 4 chars/token heuristic
	const approxTok = (s: string) => Math.ceil(s.length / 4);
	if (approxTok(text) <= maxT) return [text];
	const estChars = (t: number) => t * 4;
	const windowChars = estChars(maxT);
	const overlapChars = estChars(overlapT);
	const chunks: string[] = [];
	let start = 0;
	while (start < text.length) {
		const end = Math.min(text.length, start + windowChars);
		chunks.push(text.slice(start, end));
		if (end === text.length) break;
		start = Math.max(end - overlapChars, start + 1);
	}
	return chunks;
}

export function stepChunk(
	useCosine = true,
	embedModel: string,
): Step<ReadOutput, ChunkOutput> {
	return (log) => async (doc) => {
		const out: Doc[] = [];

		// prepare cosine splitter only once
		const svc = useCosine ? createOllamaService({ model: embedModel }) : null;
		const embedFn =
			useCosine && svc ? (texts: string[]) => svc.embedTexts(texts) : undefined;
		const chunker = useCosine && embedFn ? cosineDropChunker(embedFn) : null;

		for (const d of doc.rawDocs) {
			const t = d.meta.tokenCount ?? tok(d.text);

			// 1) tiny docs → single chunk
			if (t <= SMALL_TOKENS) {
				out.push({
					id: `${d.meta.filePath}#0`,
					text: d.text,
					meta: { ...d.meta, tokenCount: t },
				});
				continue;
			}

			let chunks: string[] = [];

			// 2) cosine (best) — with safer params to reduce “not enough segments”
			if (chunker) {
				try {
					chunks = await chunker.chunk(d.text, {
						type: "markdown",
						minChunkSize: 350, // lowered a bit
						maxChunkSize: 2000,
						overlapSize: 140,
						breakPercentile: 0.75, // slightly more permissive
						bufferSize: 3, // fewer windows -> fewer “not enough segments”
						useHeadingsOnly: false,
					});
				} catch (e) {
					log.warn?.(
						`Cosine chunk failed for ${d.meta.filePath}; falling back.`,
						e instanceof Error ? e.message : e,
					);
				}
			}

			// 3) fallback to markdown splitter if cosine yielded nothing or just 1 overly-large block
			if (!chunks || chunks.length === 0 || (chunks.length === 1 && t > 1200)) {
				const md = markdownSplitter(d.text, {
					minChunkSize: 700,
					maxChunkSize: 1900,
					useHeadingsOnly: false,
				});
				chunks = md;
				if (!md || md.length === 0) {
					// 4) last resort: greedy token chunker
					chunks = greedyTokenChunks(d.text);
					if (chunks.length === 0) {
						// absolute worst-case safety: keep whole text
						chunks = [d.text];
					}
					log.warn?.(
						`Greedy chunker used for ${d.meta.filePath} (markdown splitter produced no chunks).`,
					);
				}
			}

			// materialise
			let i = 0;
			for (const c of chunks) {
				out.push({
					id: `${d.meta.filePath}#${i++}`,
					text: c,
					meta: { ...d.meta, tokenCount: tok(c) },
				});
			}
		}

		log.info?.(`Chunked to ${out.length} segments`);
		return { ...doc, chunks: out };
	};
}
