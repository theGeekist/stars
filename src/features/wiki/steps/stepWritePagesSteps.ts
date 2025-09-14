// src/features/wiki/steps/stepWritePages.ts
import type { OllamaService } from "@jasonnathan/llm-core";
import type {
	CodeCandidate,
	CodeExplanation,
	ConsolidateCodeOut,
	ConsolidateNarrativeOut,
	ExplainCodeOut,
	HeadingsOut,
	OutlineHeadings,
	PageCoded,
	PageComposed,
	PageExplained,
	PageHeaded,
	PageInit,
	PageNarrated,
	PagePlanned,
	PageScored,
	Step,
	PlanSectionOut,
	ScoreFilesOut,
	ScoreNarrativesOut,
	SectionCandidate,
	SectionPlan,
	SelectBetweenTwoOut,
	SingleCodeOut,
	SingleNarrativeOut,
} from "../types.js";

/* =========================
   Config / thresholds
   ========================= */
const MAX_RELEVANT_LINKS = 5;

/* =========================
   JSON Schemas (Ollama-safe)
   ========================= */

const ScoreFilesSchema = {
	type: "object",
	properties: {
		scores: {
			type: "array",
			items: {
				type: "object",
				properties: {
					filePath: { type: "string" },
					score: { type: "integer" },
					why: { type: "string" },
				},
				required: ["filePath", "score"],
			},
		},
	},
	required: ["scores"],
} as const;

// Removed additionalProperties/pattern/min/max/minItems/maxItems
const HeadingsSchema = {
	type: "object",
	properties: {
		lead: { type: "string" },
		sections: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string" },
					heading: { type: "string" },
				},
				required: ["id", "heading"],
			},
		},
	},
	required: ["lead", "sections"],
} as const;

const PlanSectionSchema = {
	type: "object",
	properties: {
		must_cover: { type: "array", items: { type: "string" } },
		code_need_score: { type: "integer" },
		expected_output: { type: "string" },
		primary_files: { type: "array", items: { type: "string" } },
	},
	required: ["must_cover", "code_need_score", "primary_files"],
} as const;

const SingleCodeSchema = {
	type: "object",
	properties: {
		lang: { type: "string" },
		text: { type: "string" },
		expected_output_alignment: { type: "integer" },
		rationale: { type: "string" },
		sources: { type: "array", items: { type: "string" } },
	},
	required: ["text"],
} as const;

const SelectBetweenTwoCodeSchema = {
	type: "object",
	properties: {
		winner: { type: "string" }, // was enum; keep loose for Ollama
		why: { type: "string" },
		winner_alignment: { type: "integer" },
	},
	required: ["winner"],
} as const;

const ConsolidateCodeSchema = {
	type: "object",
	properties: {
		lang: { type: "string" },
		text: { type: "string" },
	},
	required: ["text"],
} as const;

const ExplainCodeSchema = {
	type: "object",
	properties: {
		explanation: { type: "string" },
		risks: { type: "array", items: { type: "string" } },
	},
	required: ["explanation"],
} as const;

const SingleNarrativeSchema = {
	type: "object",
	properties: {
		heading: { type: "string" },
		paragraphs: { type: "array", items: { type: "string" } },
		bullets: { type: "array", items: { type: "string" } },
		include_code: { type: "boolean" },
		sources: { type: "array", items: { type: "string" } },
	},
	required: ["heading"],
} as const;

const ScoreNarrativesSchema = {
	type: "object",
	properties: {
		scores: {
			type: "array",
			items: {
				type: "object",
				properties: {
					index: { type: "integer" },
					score: { type: "integer" },
					why: { type: "string" },
				},
				required: ["index", "score"],
			},
		},
	},
	required: ["scores"],
} as const;

const ConsolidateNarrativeSchema = {
	type: "object",
	properties: {
		heading: { type: "string" },
		paragraphs: { type: "array", items: { type: "string" } },
		bullets: { type: "array", items: { type: "string" } },
		include_code: { type: "boolean" },
	},
	required: ["heading"],
} as const;

/* =========================
   Prompt builders
   ========================= */

function p1_user_scoreFiles(
	pageTitle: string,
	pageId: string,
	files: string[],
	context: string,
) {
	return [
		`Score each FILE by relevance to this PAGE's CONTEXT. 0 = not relevant, 100 = critical.`,
		`PAGE: ${pageTitle} (id=${pageId})`,
		`FILES:`,
		...files.map((f) => `- ${f}`),
		``,
		`CONTEXT (excerpts by file):`,
		context || "(empty)",
		``,
		`Rules: keep 'why' concrete and brief.`,
		`Output: JSON only (no fences, no markdown).`,
	].join("\n");
}

function p2_user_headings(
	pageTitle: string,
	pageId: string,
	preferredFiles: string[],
	context: string,
) {
	return [
		`Produce a short lead and 2–8 grounded section headings (ids + titles). No prose.`,
		`PAGE: ${pageTitle} (id=${pageId})`,
		`Prefer these FILES:`,
		...preferredFiles.map((f) => `- ${f}`),
		``,
		`CONTEXT (excerpts):`,
		context || "(empty)",
		``,
		`Rules: avoid generic "Overview" unless strongly suggested by context.`,
	].join("\n");
}

function p3_user_planSection(
	pageTitle: string,
	section: { id: string; heading: string },
	context: string,
	preferredFiles: string[],
) {
	return [
		`Plan this single section; return must_cover bullets, a code_need_score (0..100), optional expected_output, and primary_files.`,
		`PAGE: ${pageTitle}`,
		`SECTION: ${section.heading} (id=${section.id})`,
		`Prefer FILES:`,
		...preferredFiles.map((f) => `- ${f}`),
		``,
		`CONTEXT:`,
		context || "(empty)",
	].join("\n");
}

function p4_user_codeCandidate(
	pageTitle: string,
	sectionId: string,
	expected_output: string | undefined,
	must_cover: string[],
	context: string,
) {
	return [
		`Generate ONE minimal code snippet grounded by CONTEXT.`,
		`PAGE: ${pageTitle}`,
		`SECTION id: ${sectionId}`,
		`Expected output: ${expected_output ?? "(not specified)"}`,
		`Must cover:`,
		...must_cover.map((b) => `- ${b}`),
		``,
		`CONTEXT:`,
		context || "(empty)",
		``,
		// 🔒 Hard rules to avoid CLI / JSON / prose
		`Rules:`,
		`- Return JSON only (no fences, no markdown).`,
		`- The "text" MUST be a single self-contained code snippet.`,
		`- Do NOT output shell/CLI commands (sgpt, bash, zsh, docker, curl, pip, npm, yarn, make).`,
		`- Do NOT output standalone JSON/YAML/TOML config as the snippet.`,
		`- If APIs are unknown, prefer simpler code using visible constructs.`,
	].join("\n");
}

function p4b_user_selectBetweenTwo(
	pageTitle: string,
	sectionId: string,
	a: { lang?: string; text: string; align?: number },
	b: { lang?: string; text: string; align?: number },
) {
	return [
		`Pick the better code snippet for this section (A or B).`,
		`PAGE: ${pageTitle}`,
		`SECTION id: ${sectionId}`,
		``,
		`SNIPPET A (align=${a.align ?? "?"}):\n${a.text}`,
		``,
		`SNIPPET B (align=${b.align ?? "?"}):\n${b.text}`,
		``,
		`Choose "winner": "A" or "B".`,
	].join("\n");
}

function p4c_user_consolidateCode(
	pageTitle: string,
	sectionId: string,
	a: { lang?: string; text: string },
	b: { lang?: string; text: string },
) {
	return [
		`Consolidate these two snippets into one improved snippet (preserve runnable minimalism).`,
		`PAGE: ${pageTitle}`,
		`SECTION id: ${sectionId}`,
		``,
		`SNIPPET A:\n${a.text}`,
		``,
		`SNIPPET B:\n${b.text}`,
	].join("\n");
}

function p5_user_explainCode(
	pageTitle: string,
	sectionId: string,
	code: string,
	context: string,
) {
	return [
		`Explain what the code does (no code in your output) and note risks.`,
		`PAGE: ${pageTitle}`,
		`SECTION id: ${sectionId}`,
		``,
		`CODE:`,
		code,
		``,
		`CONTEXT:`,
		context || "(empty)",
	].join("\n");
}

function p6_user_singleNarrative(
	pageTitle: string,
	sectionId: string,
	must_cover: string[],
	context: string,
	hasSelectedCode: boolean,
	codeExplanation?: string,
) {
	return [
		`Write ONE narrative for this section (no markdown formatting).`,
		`PAGE: ${pageTitle}`,
		`SECTION id: ${sectionId}`,
		`Must cover:`,
		...must_cover.map((b) => `- ${b}`),
		``,
		hasSelectedCode
			? `You MAY refer to the accompanying code snippet.`
			: `No code integration is required.`,
		codeExplanation ? `Code explanation:\n${codeExplanation}` : ``,
		``,
		`CONTEXT:`,
		context || "(empty)",
		``,
		`Output plain fields only.`,
	].join("\n");
}

function p6b_user_scoreNarratives(
	pageTitle: string,
	sectionId: string,
	candSummaries: string[],
) {
	return [
		`Score each candidate narrative for this section. 0..100.`,
		`PAGE: ${pageTitle}`,
		`SECTION id: ${sectionId}`,
		``,
		`CANDIDATES (index: short summary):`,
		...candSummaries.map((s, i) => `${i}. ${s}`),
		``,
		`Criteria: groundedness, clarity, specificity, usefulness.`,
	].join("\n");
}

function p6c_user_consolidateNarratives(
	pageTitle: string,
	sectionId: string,
	a: SectionCandidate,
	b: SectionCandidate,
) {
	const summarise = (c: SectionCandidate) => {
		const p = (c.paragraphs ?? []).join("\n");
		const bts = (c.bullets ?? []).join("\n- ");
		return [
			`Heading: ${c.heading}`,
			p ? `Paragraphs:\n${p}` : ``,
			bts ? `Bullets:\n- ${bts}` : ``,
			`Include code? ${c.include_code ? "yes" : "no"}`,
		]
			.filter(Boolean)
			.join("\n");
	};
	return [
		`Merge the strengths of Narrative A and Narrative B into ONE improved narrative (no markdown).`,
		`PAGE: ${pageTitle}`,
		`SECTION id: ${sectionId}`,
		``,
		`NARRATIVE A:\n${summarise(a)}`,
		``,
		`NARRATIVE B:\n${summarise(b)}`,
	].join("\n");
}

/* =========================
   Helpers
   ========================= */
function _buildLinks(files: string[], base?: string, sha?: string): string {
	const f = (files || []).slice(0, MAX_RELEVANT_LINKS);
	if (base && sha)
		return f.map((fp) => `- [${fp}](${base}/blob/${sha}/${fp})`).join("\n");
	return f.map((fp) => `- ${fp}`).join("\n");
}

function _renderSectionMD(
	heading: string,
	narrative: SectionCandidate | undefined,
	code?: { text: string; lang?: string },
	codeExplanation?: string,
): string {
	if (!narrative) return "";
	const out: string[] = [];
	out.push(`\n## ${heading}\n`);
	for (const p of narrative.paragraphs ?? []) out.push(`${p}\n`);
	if (narrative.bullets?.length) {
		out.push("\n");
		for (const b of narrative.bullets) out.push(`- ${b}\n`);
	}
	if (narrative.include_code && code?.text) {
		const fence = "```";
		out.push(`\n${fence}${code.lang ?? ""}\n${code.text}\n${fence}\n`);
		if (codeExplanation)
			out.push(`\n*What the code does:* ${codeExplanation}\n`);
	}
	return out.join("").trim();
}

/* =========================
   stepWritePages (with run-then-select pattern)
   ========================= */
// ---- helpers: tiny, schema-safe validators + wrappers ----------------------
const clamp01 = (n: number) => Math.max(0, Math.min(100, n | 0));
const sys = (lang: string) =>
	`You are a careful, terse technical writer. Respond in ${lang}. Conform to the provided schema. Return JSON only.`;

// If Ollama crashes on schema (rare), we try once more without schema, keeping the same checker.
async function ask<T>(
	svc: OllamaService,
	system: string,
	user: string,
	schema: Record<string, unknown> | undefined,
	check: (r: unknown) => boolean,
): Promise<T> {
	try {
		return await svc.generatePromptAndSend<T>(
			system,
			user,
			schema ? { schema } : {},
			check,
		);
	} catch {
		// last-ditch: no schema, same checker
		return await svc.generatePromptAndSend<T>(system, user, {}, check);
	}
}

function isCodeLike(text: string): boolean {
	if (!text || typeof text !== "string") return false;
	const codeMarkers =
		/(def |class |import |function\s|\(|\)|=>|;|{|\}|\bvar\b|\bconst\b|\blet\b|#include|package\s|using\s)/;
	return codeMarkers.test(text) && (text.includes("\n") || text.includes(";"));
}
function guessLang(text: string): string | undefined {
	const s = (text || "").slice(0, 400).toLowerCase();
	if (/^\s*import\s+|^\s*def\s+|^\s*class\s+|from\s+.+\s+import\b/.test(s))
		return "python";
	if (/\bconsole\.log\b|^\s*function\b|=>/.test(s)) return "javascript";
	if (/^\s*package\s+|public\s+class\s+/.test(s)) return "java";
	if (/^\s*using\s+|namespace\b/.test(s)) return "csharp";
	if (/#include\b|std::|::/.test(s)) return "cpp";
	if (/package\s+main|\bfmt\.Println\b/.test(s)) return "go";
	if (/\bfn\s+[a-z_]|println!/.test(s)) return "rust";
	if (/<[a-z-]+[^>]*>/.test(s)) return "html";
	if (/\bSELECT\b.*\bFROM\b/.test(s)) return "sql";
	return undefined;
}

// ---------------- validators per prompt ----------------
const checkScoreFiles =
	(allowed: string[]) =>
	(r: unknown): r is ScoreFilesOut => {
		const obj = r as { scores?: unknown };
		const arr = Array.isArray(obj.scores) ? obj.scores : [];
		// Accept empty if caller passed no files; else require >=1
		if ((allowed?.length ?? 0) > 0 && arr.length === 0) return false;
		for (const s of arr as Array<{ filePath?: unknown; score?: unknown }>) {
			if (!s || typeof s.filePath !== "string") return false;
			if (!Number.isFinite(Number(s.score))) return false;
		}
		return true;
	};
const checkHeadings = (r: unknown): r is HeadingsOut => {
	const obj = r as { lead?: unknown; sections?: unknown };
	if (!Array.isArray(obj.sections) || obj.sections.length === 0) return false;
	for (const s of obj.sections as Array<{ id?: unknown; heading?: unknown }>) {
		if (!s || typeof s.id !== "string" || typeof s.heading !== "string")
			return false;
	}
	return true; // lead can be empty; we fix later
};
const checkPlanSection = (r: unknown): r is PlanSectionOut => {
	const obj = r as {
		must_cover?: unknown;
		code_need_score?: unknown;
		primary_files?: unknown;
	};
	if (!Array.isArray(obj.must_cover) || obj.must_cover.length === 0)
		return false;
	if (!Number.isFinite(Number(obj.code_need_score))) return false;
	if (!Array.isArray(obj.primary_files) || obj.primary_files.length === 0)
		return false;
	return true;
};
const checkSingleCode = (r: unknown): r is SingleCodeOut => {
	const obj = r as { text?: unknown; lang?: unknown };
	if (typeof obj.text !== "string" || obj.text.trim().length < 3) return false;
	if (!isCodeLike(obj.text)) return false;
	return true; // lang may be missing or "en"
};
const checkSelectBetweenTwo = (r: unknown): r is SelectBetweenTwoOut => {
	const obj = r as { winner?: unknown };
	return obj?.winner === "A" || obj?.winner === "B";
};
const checkConsolidateCode = (r: unknown): r is ConsolidateCodeOut => {
	const obj = r as { text?: unknown };
	return typeof obj.text === "string" && obj.text.trim().length >= 3;
};
const checkExplainCode = (r: unknown): r is ExplainCodeOut => {
	const obj = r as { explanation?: unknown };
	return (
		typeof obj.explanation === "string" && obj.explanation.trim().length >= 10
	);
};
const checkSingleNarrative = (r: unknown): r is SingleNarrativeOut => {
	const obj = r as {
		heading?: unknown;
		paragraphs?: unknown;
		bullets?: unknown;
	};
	if (typeof obj.heading !== "string" || obj.heading.trim().length === 0)
		return false;
	const hasBody =
		(Array.isArray(obj.paragraphs) && obj.paragraphs.length > 0) ||
		(Array.isArray(obj.bullets) && obj.bullets.length > 0);
	return hasBody;
};
const checkScoreNarratives = (r: unknown): r is ScoreNarrativesOut => {
	const obj = r as { scores?: unknown };
	if (!Array.isArray(obj.scores) || obj.scores.length === 0) return false;
	for (const s of obj.scores as Array<{ index?: unknown; score?: unknown }>) {
		if (
			!Number.isFinite(Number(s?.index)) ||
			!Number.isFinite(Number(s?.score))
		)
			return false;
	}
	return true;
};
const checkConsolidateNarrative = (
	r: unknown,
): r is ConsolidateNarrativeOut => {
	const obj = r as { heading?: unknown };
	return typeof obj.heading === "string" && obj.heading.trim().length > 0;
};

// ---------------- S1: score files ----------------
export function s1_scoreFiles(
	svc: OllamaService,
	languageName: string,
): Step<PageInit, PageScored> {
	return (log) => async (state) => {
		const { page, pc } = state;
		const files = pc.files ?? [];

		const r = await ask<{
			scores: Array<{ filePath: string; score: number; why?: string }>;
		}>(
			svc,
			`You are a careful, terse technical writer. Respond in ${languageName}. Return JSON only.`,
			p1_user_scoreFiles(page.title, page.id, files, pc.context),
			ScoreFilesSchema,
			checkScoreFiles(files),
		);

		const sorted = (r.scores ?? [])
			.filter((s) => files.includes(String(s.filePath)))
			.map((s) => ({
				filePath: String(s.filePath),
				score: clamp01(Number(s.score) || 0),
			}))
			.sort((a, b) => b.score - a.score);

		const preferredFiles = sorted.slice(0, 6).map((s) => s.filePath);
		log.info?.(`s1_scoreFiles: top=${preferredFiles.length}`);
		return { ...state, preferredFiles };
	};
}

// ---------------- S2: headings ----------------
export function s2_headings(
	svc: OllamaService,
	languageName: string,
): Step<PageScored, PageHeaded> {
	return (log) => async (state) => {
		const { page, pc, preferredFiles } = state;

		const r = await ask<{
			lead: string;
			sections: Array<{ id: string; heading: string }>;
		}>(
			svc,
			sys(languageName),
			p2_user_headings(page.title, page.id, preferredFiles, pc.context),
			HeadingsSchema,
			checkHeadings,
		);

		const headings: OutlineHeadings = {
			pageId: page.id,
			lead: (r.lead ?? "").trim(),
			sections: Array.isArray(r.sections) ? r.sections : [],
		};
		log.info?.(`s2_headings: sections=${headings.sections.length}`);
		return { ...state, headings };
	};
}

// ---------------- S3: per-section plan ----------------
export function s3_planSections(
	svc: OllamaService,
	languageName: string,
): Step<PageHeaded, PagePlanned> {
	return (log) => async (state) => {
		const { page, pc, preferredFiles, headings } = state;
		const plans: SectionPlan[] = [];

		for (const sec of headings.sections) {
			const r = await ask<{
				must_cover: string[];
				code_need_score: number;
				expected_output?: string;
				primary_files: string[];
			}>(
				svc,
				sys(languageName),
				p3_user_planSection(page.title, sec, pc.context, preferredFiles),
				PlanSectionSchema,
				checkPlanSection,
			);

			plans.push({
				pageId: page.id,
				sectionId: sec.id,
				must_cover: (r.must_cover ?? []).map((s) => s.trim()).filter(Boolean),
				code_need_score: clamp01(r.code_need_score ?? 0),
				expected_output: (r.expected_output ?? "").trim() || undefined,
				primary_files: Array.isArray(r.primary_files)
					? r.primary_files.slice(0, 5)
					: [],
			});
		}

		log.info?.(`s3_planSections: planned=${plans.length}`);
		return { ...state, plans };
	};
}

// ---------------- S4: code gen (A/B + select + optional consolidate) ----------------
const CODE_NEED_THRESHOLD = 60;
const CODE_ALIGN_THRESHOLD = 60;
const CLOSE_SCORE_DELTA = 10;

export function s4_codeGenerateAndSelect(
	svc: OllamaService,
	languageName: string,
): Step<PagePlanned, PageCoded> {
	return (log) => async (state) => {
		const { page, pc, plans } = state;
		const codeBySection = new Map<string, CodeCandidate>();

		// Local, explicit type for generated candidate fragments
		type GenOut = {
			lang?: string;
			text: string;
			align: number;
			rationale?: string;
			sources?: string[];
		};

		const genOne = async (
			sectionId: string,
			expected_output: string | undefined,
			must_cover: string[],
		): Promise<GenOut> => {
			const r = await ask<{
				lang?: string;
				text: string;
				expected_output_alignment?: number;
				rationale?: string;
				sources?: string[];
			}>(
				svc,
				sys(languageName),
				p4_user_codeCandidate(
					page.title,
					sectionId,
					expected_output,
					must_cover,
					pc.context,
				),
				SingleCodeSchema,
				checkSingleCode,
			);

			let lang = (r.lang ?? "").trim().toLowerCase();
			if (!lang || lang === "en" || lang === "english")
				lang = guessLang(r.text) ?? "";

			return {
				lang: lang || undefined,
				text: r.text,
				align: clamp01(r.expected_output_alignment ?? 0),
				rationale: r.rationale?.trim(),
				sources: r.sources ?? [],
			};
		};

		for (const plan of plans) {
			if (plan.code_need_score < CODE_NEED_THRESHOLD) continue;

			// Generate two candidates, resilient to single failure
			let A: GenOut | null = null;
			let B: GenOut | null = null;

			try {
				A = await genOne(plan.sectionId, plan.expected_output, plan.must_cover);
			} catch (e) {
				log?.warn?.(
					`s4: candidate A failed for section=${plan.sectionId}: ${(e as Error).message}`,
				);
			}

			try {
				B = await genOne(plan.sectionId, plan.expected_output, plan.must_cover);
			} catch (e) {
				log?.warn?.(
					`s4: candidate B failed for section=${plan.sectionId}: ${(e as Error).message}`,
				);
			}

			if (!A && !B) {
				log?.warn?.(
					`s4: no valid code candidates for section=${plan.sectionId}; skipping`,
				);
				continue;
			}

			// Only A
			if (A && !B) {
				const candA: CodeCandidate = {
					candidateId: `${page.id}:${plan.sectionId}:CA`,
					pageId: page.id,
					sectionId: plan.sectionId,
					lang: A.lang,
					text: A.text,
					expected_output_alignment: Math.max(
						clamp01(A.align ?? 0),
						CODE_ALIGN_THRESHOLD,
					),
					rationale: A.rationale,
					sources: A.sources ?? [],
				};
				if ((candA.expected_output_alignment ?? 0) >= CODE_ALIGN_THRESHOLD) {
					codeBySection.set(plan.sectionId, candA);
				}
				continue;
			}

			// Only B
			if (!A && B) {
				const candB: CodeCandidate = {
					candidateId: `${page.id}:${plan.sectionId}:CB`,
					pageId: page.id,
					sectionId: plan.sectionId,
					lang: B.lang,
					text: B.text,
					expected_output_alignment: Math.max(
						clamp01(B.align ?? 0),
						CODE_ALIGN_THRESHOLD,
					),
					rationale: B.rationale,
					sources: B.sources ?? [],
				};
				if ((candB.expected_output_alignment ?? 0) >= CODE_ALIGN_THRESHOLD) {
					codeBySection.set(plan.sectionId, candB);
				}
				continue;
			}

			// Both exist (narrow for TS)
			if (!A || !B) continue;
			// Both exist
			const candA: CodeCandidate = {
				candidateId: `${page.id}:${plan.sectionId}:CA`,
				pageId: page.id,
				sectionId: plan.sectionId,
				lang: A.lang,
				text: A.text,
				expected_output_alignment: clamp01(A.align ?? 0),
				rationale: A.rationale,
				sources: A.sources ?? [],
			};
			const candB: CodeCandidate = {
				candidateId: `${page.id}:${plan.sectionId}:CB`,
				pageId: page.id,
				sectionId: plan.sectionId,
				lang: B.lang,
				text: B.text,
				expected_output_alignment: clamp01(B.align ?? 0),
				rationale: B.rationale,
				sources: B.sources ?? [],
			};

			let pick: "A" | "B" = "A";
			let judged = 0;

			try {
				const sel = await ask<{
					winner: "A" | "B";
					why?: string;
					winner_alignment?: number;
				}>(
					svc,
					sys(languageName),
					p4b_user_selectBetweenTwo(
						page.title,
						plan.sectionId,
						{
							lang: candA.lang,
							text: candA.text,
							align: candA.expected_output_alignment,
						},
						{
							lang: candB.lang,
							text: candB.text,
							align: candB.expected_output_alignment,
						},
					),
					SelectBetweenTwoCodeSchema,
					checkSelectBetweenTwo,
				);
				pick = sel.winner;
				judged = clamp01(sel.winner_alignment ?? 0);
			} catch {
				// fallback: pick by alignment
				pick =
					(candB.expected_output_alignment ?? 0) >
					(candA.expected_output_alignment ?? 0)
						? "B"
						: "A";
				log?.warn?.(
					`s4: selector failed for section=${plan.sectionId}; using alignment fallback`,
				);
			}

			const winner: CodeCandidate = pick === "B" ? candB : candA;
			const loser: CodeCandidate = pick === "B" ? candA : candB;

			const effectiveAlignment = Math.max(
				judged,
				clamp01(winner.expected_output_alignment ?? 0),
				clamp01(candA.expected_output_alignment ?? 0),
				clamp01(candB.expected_output_alignment ?? 0),
				CODE_ALIGN_THRESHOLD,
			);

			let finalCode: CodeCandidate = {
				...winner,
				expected_output_alignment: effectiveAlignment,
			};

			const diff = Math.abs(
				(candA.expected_output_alignment ?? 0) -
					(candB.expected_output_alignment ?? 0),
			);

			if (diff <= CLOSE_SCORE_DELTA) {
				try {
					const cons = await ask<{ lang?: string; text: string }>(
						svc,
						sys(languageName),
						p4c_user_consolidateCode(
							page.title,
							plan.sectionId,
							{ lang: winner.lang, text: winner.text },
							{ lang: loser.lang, text: loser.text },
						),
						ConsolidateCodeSchema,
						checkConsolidateCode,
					);
					finalCode = {
						candidateId: `${page.id}:${plan.sectionId}:CC`,
						pageId: page.id,
						sectionId: plan.sectionId,
						lang: cons.lang ?? winner.lang,
						text: cons.text,
						expected_output_alignment: effectiveAlignment,
					};
				} catch {
					// keep winner
				}
			}

			if ((finalCode.expected_output_alignment ?? 0) >= CODE_ALIGN_THRESHOLD) {
				codeBySection.set(plan.sectionId, finalCode);
			}
		}

		log.info?.(`s4_codeGenerateAndSelect: selected=${codeBySection.size}`);
		return { ...state, codeBySection };
	};
}

// ---------------- S5: explain code ----------------
export function s5_explainCode(
	svc: OllamaService,
	languageName: string,
): Step<PageCoded, PageExplained> {
	return () => async (state) => {
		const { page, pc, codeBySection } = state;
		const codeExplById = new Map<string, CodeExplanation>();

		for (const sel of codeBySection.values()) {
			const r = await ask<{ explanation: string; risks?: string[] }>(
				svc,
				sys(languageName),
				p5_user_explainCode(page.title, sel.sectionId, sel.text, pc.context),
				ExplainCodeSchema,
				checkExplainCode,
			);
			codeExplById.set(sel.candidateId, {
				candidateId: sel.candidateId,
				pageId: sel.pageId,
				sectionId: sel.sectionId,
				explanation: (r.explanation || "").trim(),
				risks: (r.risks ?? []).map((s) => s.trim()).filter(Boolean),
			});
		}

		return { ...state, codeExplById };
	};
}

// ---------------- S6: narratives (3x generate, score, maybe consolidate) ----------------
export function s6_narratives(
	svc: OllamaService,
	languageName: string,
): Step<PageExplained, PageNarrated> {
	return (log) => async (state) => {
		const { page, pc, plans, codeBySection, codeExplById } = state;
		const narrativesBySection = new Map<string, SectionCandidate>();

		for (const plan of plans) {
			const sel = codeBySection.get(plan.sectionId);
			const exp = sel ? codeExplById.get(sel.candidateId) : undefined;

			const genOne = async (idx: number) => {
				const r = await ask<{
					heading: string;
					paragraphs?: string[];
					bullets?: string[];
					include_code?: boolean;
					sources?: string[];
				}>(
					svc,
					sys(languageName),
					p6_user_singleNarrative(
						page.title,
						plan.sectionId,
						plan.must_cover,
						pc.context,
						Boolean(sel),
						exp?.explanation,
					),
					SingleNarrativeSchema,
					checkSingleNarrative,
				);
				return {
					candidateId: `${page.id}:${plan.sectionId}:S${idx + 1}`,
					pageId: page.id,
					sectionId: plan.sectionId,
					heading: (r.heading || "").trim(),
					paragraphs: r.paragraphs ?? [],
					bullets: r.bullets ?? [],
					include_code: Boolean(r.include_code),
					sources: r.sources ?? [],
				} as SectionCandidate;
			};

			const cands = [await genOne(0), await genOne(1), await genOne(2)];

			const summaries = cands.map((c) => {
				const p = (c.paragraphs ?? []).join(" ").slice(0, 160);
				const b = (c.bullets ?? []).slice(0, 3).join("; ");
				return `${c.heading} — ${p}${b ? `; bullets: ${b}` : ""}`;
			});

			const s = await ask<{
				scores: Array<{ index: number; score: number; why?: string }>;
			}>(
				svc,
				sys(languageName),
				p6b_user_scoreNarratives(page.title, plan.sectionId, summaries),
				ScoreNarrativesSchema,
				checkScoreNarratives,
			);

			const scored = (s.scores ?? [])
				.map((x) => ({
					idx: (x.index | 0) as 0 | 1 | 2,
					score: clamp01(x.score),
				}))
				.sort((a, b) => b.score - a.score);

			let best = cands[scored[0]?.idx ?? 0];
			const second = cands[scored[1]?.idx ?? 1];
			const delta =
				scored.length >= 2 ? scored[0].score - scored[1].score : 100;

			if (second && Math.abs(delta) <= CLOSE_SCORE_DELTA) {
				const cons = await ask<{
					heading: string;
					paragraphs?: string[];
					bullets?: string[];
					include_code?: boolean;
				}>(
					svc,
					sys(languageName),
					p6c_user_consolidateNarratives(
						page.title,
						plan.sectionId,
						best,
						second,
					),
					ConsolidateNarrativeSchema,
					checkConsolidateNarrative,
				);
				best = {
					candidateId: `${page.id}:${plan.sectionId}:SC`,
					pageId: page.id,
					sectionId: plan.sectionId,
					heading: (cons.heading || best.heading).trim(),
					paragraphs: cons.paragraphs ?? best.paragraphs,
					bullets: cons.bullets ?? best.bullets,
					include_code: Boolean(cons.include_code),
				};
			}

			narrativesBySection.set(plan.sectionId, best);
		}

		log.info?.(`s6_narratives: best=${narrativesBySection.size}`);
		return { ...state, narrativesBySection };
	};
}

// ---------------- S7 (compose) stays the same; no LLM call ----------------
export function s7_composeMarkdown(): Step<PageNarrated, PageComposed> {
	return () => async (state) => {
		const {
			doc,
			page,
			preferredFiles,
			headings,
			narrativesBySection,
			codeBySection,
			codeExplById,
		} = state;

		const buildLinks = (
			files: string[],
			base?: string,
			sha?: string,
		): string => {
			const f = (files || []).slice(0, 5);
			if (base && sha)
				return f.map((fp) => `- [${fp}](${base}/blob/${sha}/${fp})`).join("\n");
			return f.map((fp) => `- ${fp}`).join("\n");
		};
		const renderSectionMD = (
			heading: string,
			narrative?: SectionCandidate,
			code?: { text: string; lang?: string },
			codeExplanation?: string,
		): string => {
			if (!narrative) return "";
			const out: string[] = [];
			out.push(`\n## ${heading}\n`);
			for (const p of narrative.paragraphs ?? []) out.push(`${p}\n`);
			if (narrative.bullets?.length) {
				out.push("\n");
				for (const b of narrative.bullets) out.push(`- ${b}\n`);
			}
			if (narrative.include_code && code?.text) {
				const fence = "```";
				out.push(`\n${fence}${code.lang ?? ""}\n${code.text}\n${fence}\n`);
				if (codeExplanation)
					out.push(`\n*What the code does:* ${codeExplanation}\n`);
			}
			return out.join("").trim();
		};

		const links = buildLinks(preferredFiles, doc.webBaseUrl, doc.commitSha);
		const parts: string[] = [];
		parts.push(`# ${page.title}\n`);
		if (links.trim()) parts.push(`**Relevant source files**\n\n${links}\n\n`);
		if ((headings.lead || "").trim()) parts.push(`${headings.lead}\n`);

		for (const sec of headings.sections) {
			const narrative = narrativesBySection.get(sec.id);
			const code = codeBySection.get(sec.id);
			const exp = code ? codeExplById.get(code.candidateId) : undefined;
			const block = renderSectionMD(
				sec.heading,
				narrative,
				code ? { text: code.text, lang: code.lang } : undefined,
				exp?.explanation,
			);
			if (block.trim()) parts.push(block);
		}

		const markdown = parts.join("").trim();
		return { ...state, markdown };
	};
}
