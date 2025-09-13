/**
 * stepOutlineFromPageContext
 * Small, schema-constrained JSON prompt: produce `lead` + `sections[]` per page
 * from its page-specific CONTEXT. Mirrors generateWiki.ts usage of generatePromptAndSend.
 */
import { OllamaService } from "@jasonnathan/llm-core";
import type {
	OutlinesOutput,
	PageContext,
	PageOutline,
	PagesContextOutput,
	PipelineStep,
} from "../types.ts";

/* ---------------------------- schema ---------------------------- */

export const OutlineSchema = {
	type: "object",
	additionalProperties: false,
	required: ["lead", "sections"],
	properties: {
		lead: { type: "string", minLength: 10, maxLength: 300 },
		sections: {
			type: "array",
			minItems: 2,
			maxItems: 8,
			items: { type: "string", minLength: 3, maxLength: 80 },
		},
	},
} as const;

/* ---------------------------- helpers ---------------------------- */

function pageTypeHint(id: string, title: string): string {
	const key = `${id} ${title}`.toLowerCase();
	if (key.includes("architecture")) return "architecture";
	if (key.includes("data flow") || key.includes("data-flow"))
		return "data-flow";
	if (key.includes("setup") || key.includes("getting started")) return "setup";
	if (key.includes("configuration")) return "configuration";
	if (key.includes("deployment")) return "deployment";
	if (key.includes("training") || key.includes("hyperparameter"))
		return "training";
	if (key.includes("faq")) return "faq";
	if (key.includes("feature")) return "key-features";
	if (key.includes("use case") || key.includes("use-cases")) return "use-cases";
	return "general";
}

function sectionTemplate(kind: string): string[] {
	switch (kind) {
		case "architecture":
			return ["Overview", "Components", "Interactions", "Limitations"];
		case "data-flow":
			return ["Summary", "Inputs", "Processing", "Outputs"];
		case "setup":
			return ["Requirements", "Install", "First Run", "Uninstall/Upgrade"];
		case "configuration":
			return ["Location", "Keys & Defaults", "Tips"];
		case "deployment":
			return ["Methods", "Environment & Secrets", "Docker", "CI"];
		case "training":
			return ["Data", "Hyperparameters", "Run", "Evaluate"];
		case "key-features":
			return ["Summary", "Feature List", "Examples"];
		case "use-cases":
			return ["Scenarios", "Examples", "Tips"];
		case "faq":
			return ["Q&A"];
		default:
			return ["Overview", "Details"];
	}
}

function outlineSystem(languageName = "English") {
	return `You are a precise technical documentation outliner. Respond in ${languageName}. Conform to the provided schema. Return JSON only.`;
}

function outlineUserPrompt(pc: PageContext, _languageName: string) {
	const kind = pageTypeHint(pc.pageId, pc.title);
	const allowed = sectionTemplate(kind);

	return [
		`Task: Create a concise outline for a wiki page.`,
		`Page title: ${pc.title}`,
		`Page type: ${kind}`,
		`Guidance: Prefer section names from this list (you may reorder or omit if unsupported by context):`,
		allowed.map((s, i) => `${i + 1}. ${s}`).join("\n"),
		``,
		`CONTEXT (page-specific, budgeted):`,
		pc.context?.trim() ? pc.context : "(empty)",
	].join("\n");
}

/* ----------------------------- step ----------------------------- */

export function stepOutlineFromPageContext(
	genModel?: string,
): PipelineStep<PagesContextOutput, OutlinesOutput> {
	return (log) => async (doc) => {
		const svc = new OllamaService(genModel ?? Bun.env.OLLAMA_MODEL ?? "");
		const outlines: PageOutline[] = [];

		for (const pc of doc.pagesContext) {
			const system = outlineSystem(doc.languageName ?? "English");
			const user = outlineUserPrompt(pc, doc.languageName ?? "English");

			const res = await svc.generatePromptAndSend<{
				lead: string;
				sections: string[];
			}>(system, user, { schema: OutlineSchema });

			// minimal guardrails (we already passed schema validation in the service)
			const lead = (res.lead || "").trim();
			const sections = Array.isArray(res.sections)
				? res.sections.map((s) => s.trim()).filter(Boolean)
				: [];

			if (lead.length === 0 || sections.length === 0) {
				log.warn?.(
					`Outline for ${pc.pageId} was empty; falling back to default sections.`,
				);
				const fallback = sectionTemplate(pageTypeHint(pc.pageId, pc.title));
				outlines.push({
					pageId: pc.pageId,
					lead: lead || `Overview of ${pc.title}.`,
					sections: fallback,
				});
			} else {
				outlines.push({ pageId: pc.pageId, lead, sections });
			}

			log.info?.(`Outlined ${pc.pageId} with ${sections.length} sections`);
		}

		return { ...doc, outlines };
	};
}
