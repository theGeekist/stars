// src/features/wiki/steps/retrieve.ts
import { OllamaService } from "@jasonnathan/llm-core";
import { getEncoding } from "js-tiktoken";
import type { Step, RetrievalOutput, StoreOutput } from "../types";
import { searchStore } from "./embedAndStore";

const enc = getEncoding("cl100k_base");
const approx = (s: string): number => {
	try {
		return enc.encode(s).length;
	} catch {
		return Math.max(1, s.length >> 2);
	}
};

type Hit = { text: string; score: number; meta: { filePath: string } };

export function stepRetrieve(options: {
	query?: string;
	k?: number;
	perFileLimit?: number;
	budget: { numCtx: number; contextShare?: number };
	embedModel: string;
	/** reserve tokens for system+user prompt, fileTree/readme, etc. */
	promptReserve?: number; // default 300
	/** extra margin to cover tokenizer mismatch (e.g., LLaMA vs cl100k) */
	safetyMarginPct?: number; // default 0.05 (5%)
}): Step<StoreOutput, RetrievalOutput> {
	const {
		query = "what is this project, its core purpose, technical approach, and standout capability",
		k = 32,
		perFileLimit = 3,
		budget,
		embedModel,
		promptReserve = 300,
		safetyMarginPct = 0.05,
	} = options;

	return (log) => async (doc) => {
		const svc = new OllamaService(embedModel);
		const [[qv]] = [await svc.embedTexts([query])];

		const rawHits = (await searchStore(doc.storePath, qv, k)) as Hit[];
		// Group by file and sort within each file by score (desc)
		const byFile = new Map<string, Hit[]>();
		for (const h of rawHits) {
			const arr = byFile.get(h.meta.filePath);
			if (arr) arr.push(h);
			else byFile.set(h.meta.filePath, [h]);
		}
		for (const [, group] of byFile) group.sort((a, b) => b.score - a.score);

		// Hard cap for retrieved context
		const share =
			typeof budget.contextShare === "number" ? budget.contextShare : 0.45;
		const rawCtx = Math.floor(budget.numCtx * share);
		const maxCtx = Math.max(
			0,
			rawCtx - promptReserve - Math.floor(rawCtx * safetyMarginPct),
		);

		log.info?.(
			`Context planning: raw=${rawCtx}, reserve=${promptReserve}, margin=${Math.floor(
				rawCtx * safetyMarginPct,
			)} -> max=${maxCtx}`,
		);

		if (maxCtx <= 0) {
			log.warn?.(
				"Context budget is zero or negative after reserves; skipping retrieval context.",
			);
			return { ...doc, context: "", contextTokens: 0 };
		}

		// Assemble blocks incrementally with precise measurements
		const sep = `\n\n${"-".repeat(10)}\n\n`;
		const blocks: Array<{ filePath: string; content: string }> = [];
		let totalTokens = 0;
		let filesUsed = 0;

		for (const [filePath, group] of byFile) {
			let taken = 0;
			const header = `## File Path: ${filePath}\n\n`;
			let body = "";

			for (const g of group) {
				if (taken >= perFileLimit) break;

				const nextBody = body ? `${body}\n\n${g.text}` : g.text;
				// Candidate cost if we add this chunk (with header, once)
				const candidateContent = header + nextBody;
				const candidateBlock =
					blocks.length === 0 ? candidateContent : sep + candidateContent;
				const candidateTokens = totalTokens + approx(candidateBlock);

				if (candidateTokens <= maxCtx) {
					body = nextBody;
					totalTokens = candidateTokens;
					taken += 1;
				} else {
				}
			}

			if (taken > 0) {
				blocks.push({ filePath, content: header + body });
				filesUsed += 1;
			}
		}

		// Fallback: if nothing fit (very tight budgets), try the single best chunk overall
		if (blocks.length === 0 && rawHits.length > 0) {
			const top = rawHits[0];
			const single = `## File Path: ${top.meta.filePath}\n\n${top.text}`;
			const singleTokens = approx(single);
			if (singleTokens <= maxCtx) {
				blocks.push({ filePath: top.meta.filePath, content: single });
				totalTokens = singleTokens;
				filesUsed = 1;
			} else {
				// Extreme edge: trim the top chunk to fit
				const encoded = enc.encode(single);
				const trimmed = enc.decode(encoded.slice(0, Math.max(0, maxCtx - 32)));
				blocks.push({ filePath: top.meta.filePath, content: trimmed });
				totalTokens = approx(trimmed);
				filesUsed = 1;
			}
		}

		// Final hard cap (rare): trim from the tail until it fits
		// (recalculate tokens on the joined string for safety)
		const joinedInitial = blocks.map((b) => b.content).join(sep);
		let context = joinedInitial;
		while (approx(context) > maxCtx && blocks.length > 0) {
			blocks.pop();
			context = blocks.map((b) => b.content).join(sep);
		}

		const tokens = approx(context);
		log.info?.(
			`Context budget used: ${tokens}/${maxCtx} tokens across ${filesUsed} files`,
		);
		return { ...doc, context, contextTokens: tokens };
	};
}
