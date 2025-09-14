// src/features/wiki/steps/generateWiki.ts
import { Logger, OllamaService, pipeline } from "@jasonnathan/llm-core";
import type { RetrievalOutput, WikiJSON, WikiOutput, Step } from "../types.ts";

/* ────────────────────────────────────────────────────────────────────────── */
/* Original final schema (unchanged)                                          */
/* ────────────────────────────────────────────────────────────────────────── */
export const WikiSchema = {
	type: "object",
	required: ["title", "pages"],
	properties: {
		title: { type: "string" },
		description: { type: "string" },
		pages: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				required: ["id", "title", "importance"],
				properties: {
					id: { type: "string" },
					title: { type: "string" },
					description: { type: "string" },
					importance: { type: "string", enum: ["high", "medium", "low"] },
					relevant_files: { type: "array", items: { type: "string" } },
					related_pages: { type: "array", items: { type: "string" } },
					parent_section: { type: "string" },
				},
				additionalProperties: false,
			},
		},
		sections: {
			type: "array",
			items: {
				type: "object",
				required: ["id", "title"],
				properties: {
					id: { type: "string" },
					title: { type: "string" },
					pages: { type: "array", items: { type: "string" } },
					subsections: { type: "array", items: { type: "string" } },
				},
				additionalProperties: false,
			},
		},
	},
	additionalProperties: false,
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Small inner schemas (focused)                                              */
/* ────────────────────────────────────────────────────────────────────────── */
type PagesSeed = {
	title: string;
	description?: string;
	pages: Array<{
		id: string;
		title: string;
		importance: "high" | "medium" | "low";
	}>;
};
const PagesSeedSchema = {
	type: "object",
	required: ["title", "pages"],
	additionalProperties: false,
	properties: {
		title: { type: "string", minLength: 3 },
		description: { type: "string" },
		pages: {
			type: "array",
			minItems: 1,
			maxItems: 24,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "title", "importance"],
				properties: {
					id: { type: "string", minLength: 2, maxLength: 64 },
					title: { type: "string", minLength: 3, maxLength: 80 },
					importance: { type: "string", enum: ["high", "medium", "low"] },
				},
			},
		},
	},
} as const;

type RelevantFilesOut = { relevant_files: string[] };
const RelevantFilesSchema = {
	type: "object",
	required: ["relevant_files"],
	additionalProperties: false,
	properties: {
		relevant_files: {
			type: "array",
			minItems: 0,
			maxItems: 6,
			items: { type: "string" },
		},
	},
} as const;

type SectionsOut = {
	sections: Array<{
		id: string;
		title: string;
		pages?: string[];
		subsections?: string[];
	}>;
};
const SectionsSchema = {
	type: "object",
	required: ["sections"],
	additionalProperties: false,
	properties: {
		sections: {
			type: "array",
			minItems: 1,
			maxItems: 12,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "title"],
				properties: {
					id: { type: "string", minLength: 2, maxLength: 64 },
					title: { type: "string", minLength: 3, maxLength: 80 },
					pages: { type: "array", items: { type: "string" } },
					subsections: { type: "array", items: { type: "string" } },
				},
			},
		},
	},
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Prompt builders                                                            */
/* ────────────────────────────────────────────────────────────────────────── */
const sys = (lang: string) =>
	[
		`You are a careful, terse technical writer. Respond in ${lang}.`,
		`STRICT OUTPUT RULES:`,
		`- Conform to schema.`,
		`- JSON only. No markdown, no fences, no preface.`,
	].join(" ");

function p_seed(
	ownerRepo: string,
	pagesTarget: number,
	comprehensive: boolean,
	fileTree?: string,
	readme?: string,
	context?: string,
) {
	return [
		`Task: Propose the wiki outline for ${ownerRepo}.`,
		`Produce:`,
		`- "title" (short)`,
		`- optional "description" (1–2 sentences)`,
		`- "pages": ${pagesTarget} focused pages {id, title, importance}.`,
		comprehensive
			? `No sections yet; sections will be created later.`
			: `Sections are not required.`,
		fileTree ? `\n<file_tree>\n${fileTree}\n</file_tree>` : "",
		readme ? `\n<readme>\n${readme}\n</readme>` : "",
		context ? `\n<START_OF_CONTEXT>\n${context}\n<END_OF_CONTEXT>` : "",
	].join("\n");
}

function p_filesForPage(
	page: { id: string; title: string },
	candidatePaths: string[],
	ownerRepo: string,
) {
	return [
		`Pick up to 6 repo file paths that are most relevant to PAGE.`,
		`Choose ONLY from CANDIDATES below (return [] if none apply).`,
		``,
		`REPO: ${ownerRepo}`,
		`PAGE: ${page.title} (id=${page.id})`,
		``,
		`CANDIDATE PATHS:`,
		...candidatePaths.map((p) => `- ${p}`),
	].join("\n");
}

function p_sections(
	ownerRepo: string,
	pages: Array<{ id: string; title: string }>,
) {
	return [
		`Define 2–8 logical sections for the wiki; reference page ids in "pages" where relevant.`,
		`Use ONLY these page ids:`,
		...pages.map((p) => `- ${p.id} (${p.title})`),
		``,
		`REPO: ${ownerRepo}`,
	].join("\n");
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers + customCheck validators                                           */
/* ────────────────────────────────────────────────────────────────────────── */
async function ask<T>(
	svc: OllamaService,
	system: string,
	user: string,
	schema: Record<string, unknown> | undefined,
	check: (r: T) => T | boolean,
): Promise<T> {
	// Attempt 1: full schema if provided; otherwise generic JSON mode
	try {
		return await svc.generatePromptAndSend<T>(
			system,
			user,
			schema ? { schema } : { schema: "json" },
			check,
		);
	} catch {
		// Attempt 2: always force generic JSON framing (prevents non-JSON / double-parse)
		return await svc.generatePromptAndSend<T>(
			system,
			user,
			{ schema: "json" },
			check,
		);
	}
}

function validPathSet(doc: RetrievalOutput): Set<string> {
	const s = new Set<string>();
	for (const d of doc.rawDocs ?? []) {
		const fp = d?.meta?.filePath;
		if (typeof fp === "string" && fp) s.add(fp);
	}
	if (doc.readme) s.add("README.md");
	return s;
}

function pickCandidatePaths(all: Set<string>, limit = 60): string[] {
	const arr = Array.from(all);
	arr.sort((a, b) => a.length - b.length);
	return arr.slice(0, limit);
}

function checkSeed(pagesTarget: number) {
	return (r: PagesSeed) => {
		if (!r || typeof r !== "object") return false;
		if (typeof r.title !== "string" || !r.title.trim()) return false;
		if (!Array.isArray(r.pages) || r.pages.length < 1) return false;
		if (r.pages.length > Math.max(2 * pagesTarget, pagesTarget + 6))
			return false;
		const ids = new Set<string>();
		for (const p of r.pages) {
			if (!p || typeof p !== "object") return false;
			if (typeof p.id !== "string" || !p.id.trim()) return false;
			if (ids.has(p.id)) return false;
			ids.add(p.id);
			if (typeof p.title !== "string" || !p.title.trim()) return false;
			if (!["high", "medium", "low"].includes(p.importance as any))
				return false;
		}
		return r;
	};
}

function checkRelevant(valid: Set<string>) {
	return (r: RelevantFilesOut) => {
		if (!r || typeof r !== "object") return false;
		if (!Array.isArray(r.relevant_files)) return false;
		for (const fp of r.relevant_files) {
			if (typeof fp !== "string" || !valid.has(fp)) return false;
		}
		return r;
	};
}

function checkSections(validPageIds: Set<string>) {
	return (r: SectionsOut) => {
		if (!r || typeof r !== "object") return false;
		if (!Array.isArray(r.sections) || r.sections.length === 0) return false;
		for (const s of r.sections) {
			if (!s || typeof s !== "object") return false;
			if (typeof s.id !== "string" || !s.id.trim()) return false;
			if (typeof s.title !== "string" || !s.title.trim()) return false;
			if (Array.isArray(s.pages)) {
				for (const pid of s.pages) {
					if (typeof pid !== "string" || !validPageIds.has(pid)) return false;
				}
			}
		}
		return r;
	};
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Inner steps (composable)                                                   */
/* ────────────────────────────────────────────────────────────────────────── */
type S1 = RetrievalOutput & { _seed: PagesSeed };
type S2 = S1 & { _pagesWithFiles: PagesSeed["pages"] & any[] }; // pages with relevant_files
type S3 = S2 & { _sections?: SectionsOut["sections"] };

function s1_seedPages(
	svc: OllamaService,
	pagesTarget: number,
	comprehensive: boolean,
): Step<RetrievalOutput, S1> {
	return (log) => async (doc) => {
		const system = sys(doc.languageName);
		const seed = await ask<PagesSeed>(
			svc,
			system,
			p_seed(
				doc.ownerRepo,
				pagesTarget,
				comprehensive,
				doc.fileTree,
				doc.readme,
				doc.context,
			),
			PagesSeedSchema,
			checkSeed(pagesTarget),
		);
		log.info?.(`generateWiki.s1: seeded ${seed.pages.length} pages`);
		return { ...doc, _seed: seed };
	};
}

function s2_attachRelevantFiles(svc: OllamaService): Step<S1, S2> {
	return (log) => async (state) => {
		const { _seed } = state;
		const system = sys(state.languageName);
		const validPaths = validPathSet(state);
		const candidates = pickCandidatePaths(validPaths, 60);

		const withFiles: Array<
			PagesSeed["pages"][number] & { relevant_files: string[] }
		> = [];

		for (const p of _seed.pages) {
			// If there are no candidates at all, skip the LLM round-trip.
			if (candidates.length === 0) {
				withFiles.push({ ...p, relevant_files: [] });
				continue;
			}

			const rel = await ask<RelevantFilesOut>(
				svc,
				system,
				p_filesForPage(
					{ id: p.id, title: p.title },
					candidates,
					state.ownerRepo,
				),
				RelevantFilesSchema,
				checkRelevant(validPaths),
			);
			withFiles.push({ ...p, relevant_files: rel.relevant_files });
		}
		log.info?.(
			`generateWiki.s2: attached relevant_files for ${withFiles.length} pages`,
		);
		return { ...state, _pagesWithFiles: withFiles };
	};
}

function s3_sectionsIfNeeded(
	svc: OllamaService,
	comprehensive: boolean,
): Step<S2, S3> {
	return (log) => async (state) => {
		if (!comprehensive) return { ...state };
		const system = sys(state.languageName);
		const pageList = state._pagesWithFiles.map(({ id, title }) => ({
			id,
			title,
		}));
		const idSet = new Set(pageList.map((p) => p.id));

		const secOut = await ask<SectionsOut>(
			svc,
			system,
			p_sections(state.ownerRepo, pageList),
			SectionsSchema,
			checkSections(idSet),
		);
		log.info?.(`generateWiki.s3: sections=${secOut.sections.length}`);
		return { ...state, _sections: secOut.sections };
	};
}

function s4_stitch(): Step<S3, WikiOutput> {
	return (_log) => async (state) => {
		const normalizedSections = state._sections?.map((s) => {
			const out: {
				id: string;
				title: string;
				pages: string[];
				subsections?: string[];
			} = {
				id: s.id,
				title: s.title,
				pages: Array.isArray(s.pages) ? s.pages : [],
			};
			if (Array.isArray(s.subsections) && s.subsections.length > 0) {
				out.subsections = s.subsections;
			}
			return out;
		});

		const pages = state._pagesWithFiles as unknown as WikiJSON["pages"];

		const wiki: WikiJSON = {
			title: state._seed.title,
			description: state._seed.description,
			pages,
			...(normalizedSections ? { sections: normalizedSections } : {}),
		};

		const okTitle =
			typeof wiki.title === "string" && wiki.title.trim().length > 0;
		const okPages = Array.isArray(wiki.pages) && wiki.pages.length > 0;
		if (!okTitle || !okPages) {
			throw new Error("generateWiki: final wiki failed minimal validation");
		}

		return { ...state, wiki };
	};
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Exported step — builds and runs an inner pipeline                          */
/* ────────────────────────────────────────────────────────────────────────── */
export function stepGenerateWiki(
	pagesTarget: number,
	comprehensive: boolean,
	genModel?: string,
): Step<RetrievalOutput, WikiOutput> {
	return (_log) => async (doc) => {
		const svc = new OllamaService(genModel ?? Bun.env.OLLAMA_MODEL ?? "");
		const innerLogger = new Logger("./run-generate-wiki.md", Bun.env.NTFY_URL);

		const inner = pipeline<Logger, RetrievalOutput>(innerLogger)
			.addStep(s1_seedPages(svc, pagesTarget, comprehensive))
			.addStep(s2_attachRelevantFiles(svc))
			.addStep(s3_sectionsIfNeeded(svc, comprehensive))
			.addStep(s4_stitch());

		return inner.run(doc);
	};
}
