// src/features/wiki/steps/crosslinkSimple.ts
import type {
	CrosslinkedOutput,
	DraftsEnrichedOutput,
	PageDraft,
	Step,
} from "../types.ts";

export function stepCrosslinkSimple(): Step<
	DraftsEnrichedOutput,
	CrosslinkedOutput
> {
	return () => async (doc) => {
		const titleById = new Map<string, string>(
			doc.wiki.pages.map((p) => [p.id, p.title]),
		);
		const relatedById = new Map<string, string[]>(
			doc.wiki.pages.map((p) => [p.id, p.related_pages ?? []]),
		);

		const out: PageDraft[] = doc.drafts.map((d) => {
			const related = (relatedById.get(d.pageId) || []).slice(0, 2);
			if (related.length === 0) return d;

			const base = (
				d.markdown ?? `# ${titleById.get(d.pageId) ?? d.pageId}\n`
			).trimEnd();
			const links = related
				.map((id) => {
					const t = titleById.get(id) ?? id;
					return `- See also: **${t}** (../${id}.md)`;
				})
				.join("\n");

			const sep = base.endsWith("\n") ? "" : "\n";
			return { ...d, markdown: `${base}${sep}\n---\n${links}\n` };
		});

		return { ...doc, drafts: out };
	};
}
