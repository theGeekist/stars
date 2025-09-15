/**
 * stepRetrieveForPages (per-page)
 * Builds a compact, budgeted CONTEXT per wiki page using the existing vector store.
 */
import { OllamaService } from "@jasonnathan/llm-core";
import { getEncoding } from "js-tiktoken";
import type {
	PageContext,
	PagesContextOutput,
	RetrievePerPageOpts,
	Step,
	StoreOutput,
	WikiPage,
	WithRevision,
} from "../types.ts";
import { searchStore } from "./embedAndStore";

const enc = getEncoding("cl100k_base");
const tok = (s: string) => {
	try {
		return enc.encode(s).length;
	} catch {
		return Math.max(1, s.length >> 2);
	}
};

function pageQuery(page: WikiPage): string {
	const rf = Array.isArray(page.relevant_files)
		? page.relevant_files.join(", ")
		: "";
	const desc = page.description ? ` — ${page.description}` : "";
	return `${page.title}${desc} — focus:${page.id} — files:${rf}`;
}

export function stepRetrieveForPages(
	options: RetrievePerPageOpts,
): Step<WithRevision, PagesContextOutput> {
	const { k = 24, perFileLimit = 3, budget, embedModel } = options;

	return (log) => async (doc) => {
		const svc = new OllamaService(embedModel);

		const buildFor = async (page: WikiPage): Promise<PageContext> => {
			const query = pageQuery(page);
			const [[qv]] = [await svc.embedTexts([query])];

			const hits = await searchStore((doc as StoreOutput).storePath, qv, k);
			// Group by filePath; take best N per file while respecting token budget
			const byFile = new Map<string, typeof hits>();
			for (const h of hits) {
				const fp = h.meta.filePath;
				const arr = byFile.get(fp);
				if (arr) arr.push(h);
				else byFile.set(fp, [h]);
			}
			for (const [, arr] of byFile) arr.sort((a, b) => b.score - a.score);

			const sep = `\n\n${"-".repeat(10)}\n\n`;
			const blocks: string[] = [];
			const usedFiles: string[] = [];
			let total = 0;
			const maxT = budget.numCtx;

			for (const [fp, arr] of byFile) {
				let taken = 0;
				let body = "";
				const header = `## File Path: ${fp}\n\n`;
				for (const h of arr) {
					if (taken >= perFileLimit) break;
					const candidate = header + (body ? `${body}\n\n${h.text}` : h.text);
					const piece = blocks.length === 0 ? candidate : sep + candidate;
					const cost = tok(piece);
					if (total + cost <= maxT) {
						body = body ? `${body}\n\n${h.text}` : h.text;
						total += cost;
						taken++;
					} else {
						break;
					}
				}
				if (taken > 0) {
					blocks.push(header + body);
					usedFiles.push(fp);
				}
				if (total >= maxT) break;
			}

			// Fallback: ensure at least something exists
			const context = blocks.join(sep);
			return {
				pageId: page.id,
				title: page.title,
				context,
				files: usedFiles.slice(0, 8),
			};
		};

		const pagesContext: PageContext[] = [];
		for (const p of doc.wiki.pages) {
			const pc = await buildFor(p);
			pagesContext.push(pc);
			log.info?.(
				`Built context for page=${p.id} (${tok(pc.context)} tokens, files=${pc.files.length})`,
			);
		}

		return { ...doc, pagesContext };
	};
}
