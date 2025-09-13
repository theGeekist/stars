// src/features/wiki/steps/validateAndPack.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	CrosslinkedOutput,
	PackedOutput,
	PipelineStep,
} from "../types.ts";

function hasTopHeading(md: string): boolean {
	return /^#\s+.+/m.test(md);
}
function fencesBalanced(md: string): boolean {
	const count = (md.match(/```/g) || []).length;
	return count % 2 === 0;
}

export function stepValidateAndPack(
	distDir = "dist/wiki",
): PipelineStep<CrosslinkedOutput & { commitSha: string }, PackedOutput> {
	return (log) => async (doc) => {
		const ids = new Set<string>();
		for (const p of doc.wiki.pages) {
			if (ids.has(p.id)) throw new Error(`Duplicate page id: ${p.id}`);
			ids.add(p.id);
		}
		if (doc.drafts.length !== doc.wiki.pages.length) {
			log.warn?.(
				`Draft count (${doc.drafts.length}) != pages (${doc.wiki.pages.length})`,
			);
		}

		const dirPages = join(distDir, "pages");
		await mkdir(dirPages, { recursive: true });

		for (const d of doc.drafts) {
			const md = d.markdown ?? ""; // <— guard
			if (!hasTopHeading(md)) log.warn?.(`No H1 in ${d.pageId}`);
			if (!fencesBalanced(md))
				log.warn?.(`Unbalanced code fences in ${d.pageId}`);
			const file = join(dirPages, `${d.pageId}.md`);
			await writeFile(file, md, "utf8");
			log.impt?.(`Wrote ${file}`);
		}

		const index = {
			title: doc.wiki.title,
			commitSha: doc.commitSha ?? null,
			pages: doc.wiki.pages.map((p) => ({
				id: p.id,
				title: p.title,
				related: p.related_pages ?? [],
			})),
		};
		await writeFile(
			join(distDir, "index.json"),
			JSON.stringify(index, null, 2),
			"utf8",
		);
		log.impt?.(`Index written → ${join(distDir, "index.json")}`);

		return { ...doc, distDir };
	};
}
