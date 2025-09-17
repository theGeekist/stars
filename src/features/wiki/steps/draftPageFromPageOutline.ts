/**
 * stepDraftFromPageOutline
 * Writes final Markdown for each page using the page-specific CONTEXT + outline.
 * Mirrors generateWiki.ts by calling OllamaService.generatePromptAndSend with `{ schema }`.
 * Outputs a JSON object `{ markdown }`, then unwraps to PageDraft.
 */
import { createOllamaService } from "@jasonnathan/llm-core";
import type {
	DraftsOutput,
	OutlinesOutput,
	PageContext,
	PageDraft,
	PageOutline,
	Step,
} from "../types.ts";

/** JSON Schema for the model output (object-only; service enforces conformance). */
const DraftSchema = {
	type: "object",
	additionalProperties: false,
	required: ["markdown"],
	properties: {
		markdown: { type: "string", minLength: 50 },
	},
} as const;

function relevantLinks(files: string[], base: string, sha: string): string {
	return (files || [])
		.slice(0, 5)
		.map((fp) => `- [${fp}](${base}/blob/${sha}/${fp})`)
		.join("\n");
}

function draftSystem(languageName = "English") {
	// Keep consistent with your house style: schema-constrained, object-only response.
	return `You are a senior technical writer. Respond in ${languageName}. Conform to the provided schema. Return JSON only.`;
}

export function stepDraftFromPageOutline(
	genModel?: string,
): Step<
	OutlinesOutput & { commitSha: string; webBaseUrl: string },
	DraftsOutput
> {
	return (log) => async (doc) => {
		const svc = createOllamaService({
			model: genModel ?? Bun.env.OLLAMA_MODEL ?? "",
		});
		const ctxById = new Map<string, PageContext>(
			doc.pagesContext.map((p) => [p.pageId, p]),
		);
		const outlineById = new Map<string, PageOutline>(
			doc.outlines.map((o) => [o.pageId, o]),
		);
		const drafts: PageDraft[] = [];

		for (const page of doc.wiki.pages) {
			const pc = ctxById.get(page.id);
			const ol = outlineById.get(page.id);
			if (!pc || !ol) {
				log.warn?.(`Missing context/outline for page ${page.id}; skipping.`);
				continue;
			}

			const system = draftSystem(doc.languageName ?? "English");

			// Build a single, explicit user prompt. Model must only use provided CONTEXT.
			const user = [
				`Title: ${page.title}`,
				`Lead: ${ol.lead}`,
				`Sections (write in this order):`,
				ol.sections.map((s, i) => `${i + 1}. ${s}`).join("\n"),
				``,
				`Relevant source files (render these as a bullet list immediately after the H1):`,
				relevantLinks(pc.files, doc.webBaseUrl, doc.commitSha) || "(none)",
				``,
				`CONTEXT (use only what appears here; do not invent or speculate):`,
				pc.context?.trim() ? pc.context : "(empty)",
				``,
				`Render rules:`,
				`- Start with "# ${page.title}" (or "# Overview" if appropriate).`,
				`- Immediately add the "Relevant source files" list exactly as provided.`,
				`- Then write each section from the outline, in order.`,
				`- Prefer bullets for lists; include code/CLI blocks only if they appear in CONTEXT.`,
				`- Keep it concise and scannable; British English.`,
			].join("\n");

			// IMPORTANT: match generateWiki.ts — pass { schema } (no "format" wrapper).
			const res = await svc.generatePromptAndSend<{ markdown: string }>(
				system,
				user,
				{ schema: DraftSchema },
			);

			const markdown = (res.markdown || "").trim();
			if (markdown.length < 50) {
				log.warn?.(
					`Draft for ${page.id} seems too short (${markdown.length} chars).`,
				);
			}

			drafts.push({ pageId: page.id, markdown });
			log.info?.(`Drafted ${page.id} (${markdown.length} chars)`);
		}

		return { ...doc, drafts };
	};
}
