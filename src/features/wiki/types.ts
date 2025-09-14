import type { PipelineStep, Logger } from "@jasonnathan/llm-core";

export type RepoInput = {
	repoUrlOrPath: string; // local path or URL
	ownerRepo: string; // e.g. "owner/repo" (for prompts)
	languageName: string; // e.g. "English"
	fileTree?: string;
	readme?: string;
	dbDir: string; // where to persist vector store
	dbName: string; // e.g. "owner_repo"
};

export type FilterOptions = {
	excludedDirs?: string[];
	excludedFiles?: string[]; // exact
	includedDirs?: string[];
	includedFiles?: string[]; // exact/suffix
};

export type Budget = { numCtx: number; contextShare?: number }; // default 0.45

export type Doc = {
	id: string;
	text: string;
	meta: {
		repoRoot: string;
		filePath: string;
		isCode: boolean;
		tokenCount: number;
	};
	embedding?: number[];
};

export type RetrieverHit = Doc & { score: number };

export type WikiSection = {
	id: string;
	title: string;
	pages: string[];
	subsections?: string[];
};

export type WikiPage = {
	id: string;
	title: string;
	description?: string;
	importance?: "high" | "medium" | "low";
	relevant_files?: string[];
	related_pages?: string[];
	parent_section?: string;
};

export type WikiJSON = {
	title: string;
	description?: string;
	pages: WikiPage[];
	sections?: WikiSection[];
};

export type ResolvedRepo = RepoInput & { repoRoot: string; dbFile: string };
export type ReadOutput = ResolvedRepo & { rawDocs: Doc[] };
export type ChunkOutput = ReadOutput & { chunks: Doc[] };
export type StoreOutput = ChunkOutput & { storePath: string };
export type RetrievalOutput = StoreOutput & {
	context: string;
	contextTokens: number;
};
export type WikiOutput = RetrievalOutput & { wiki: WikiJSON };

export type StoreDoc = {
	id: string;
	text: string;
	meta: { filePath: string };
	embedding?: number[];
};

// -------- Post-wiki writer types (strictly composable) ---------------------

/** Resolved commit info for permalink generation (added immediately after WikiOutput). */
export type RepoRevision = { commitSha: string; webBaseUrl: string };

/** WikiOutput augmented with revision pinning (output of stepResolveRepoSha). */
export type WikiWithRevision = WikiOutput & RepoRevision;

/** Page-specific retrieval result used to write narrative from. */
export type PageContext = {
	pageId: string;
	title: string;
	context: string;
	files: string[];
};

/** Minimal outline to keep drafts deterministic and page-type consistent. */
export type PageOutline = { pageId: string; lead: string; sections: string[] };

/** Output of stepRetrieveForPages: keep everything and add pagesContext. */
export type PagesContextOutput = WikiWithRevision & {
	pagesContext: PageContext[];
};

/** Output of stepOutlineFromPageContext: keep everything and add outlines. */
export type OutlinesOutput = PagesContextOutput & {
	outlines: PageOutline[];
};

/** Final page artefact (Markdown per page). */
export type PageDraft = { pageId: string; markdown: string };

/** Output of stepDraftFromPageOutline: keep everything and add drafts. */
export type DraftsOutput = OutlinesOutput & {
	drafts: PageDraft[];
};

/** Optional enrichment / cross-linking do not change the shape. */
export type DraftsEnrichedOutput = DraftsOutput;
export type CrosslinkedOutput = DraftsEnrichedOutput;

/** Final packaged wiki artefacts on disk. */
export type PackedOutput = CrosslinkedOutput & { distDir: string };

/* -------------------- Options for per-page retrieve -------------------- */

export type RetrievePerPageOpts = {
	k?: number;
	perFileLimit?: number;
	budget: { numCtx: number };
	embedModel: string;
};

/* Back-compat alias if you referenced WithRevision elsewhere. */
export type WithRevision = WikiWithRevision;

/* ============================================================================
	 Micro-pipeline types (ADD-ONLY; no breaking changes)
	 ============================================================================ */

/** File relevance (per page) scored by the model. */
export type PageFileRelevance = {
	pageId: string;
	scores: Array<{ filePath: string; score: number; why?: string }>; // 0..100
};

/** Headings (no prose) + lead paragraph */
export type OutlineHeadings = {
	pageId: string;
	lead: string;
	sections: Array<{ id: string; heading: string }>;
};

/** Section-level micro-plan with code need scored (0..100). */
export type SectionPlan = {
	pageId: string;
	sectionId: string;
	must_cover: string[];
	code_need_score: number; // 0..100
	expected_output?: string;
	primary_files: string[]; // preferred file paths
};

/** Code snippet candidate (pure code; no narrative). */
export type CodeCandidate = {
	candidateId: string; // deterministic id we assign
	pageId: string;
	sectionId: string;
	lang?: string;
	text: string;
	expected_output_alignment?: number; // 0..100
	rationale?: string;
	sources?: string[];
};

/** Explanation for a code candidate (no code). */
export type CodeExplanation = {
	candidateId: string;
	pageId: string;
	sectionId: string;
	explanation: string;
	risks?: string[];
};

/** Narrative candidates (2–3) per section. */
export type SectionCandidate = {
	candidateId: string; // we assign (S1/S2/S3)
	pageId: string;
	sectionId: string;
	heading: string;
	paragraphs?: string[]; // plain text, no markdown
	bullets?: string[];
	include_code?: boolean; // if true and a code candidate is selected, we’ll render it
	sources?: string[];
};

/** Deterministically composed final section block in Markdown. */
export type ComposedSection = {
	pageId: string;
	sectionId: string;
	bodyMarkdown: string; // "## Heading\n...\n```lang\ncode\n```"
};

/* Note: We do NOT export new pipeline-wide outputs here, because
	 the inner pipeline is encapsulated inside stepWritePages and returns
	 your existing DraftsOutput shape (OutlinesOutput & { drafts: PageDraft[] }).
*/

/* ============================================================================
	 Selection decisions (inner pipeline; kept public so everything's in one place)
	 ============================================================================ */

export type CodeSelectionDecision = {
	winner: "A" | "B";
	why?: string;
	winner_alignment?: number; // 0..100
	// Optional: if consolidation was requested, we keep the merged/improved code
	consolidated?: { lang?: string; text: string };
};

export type NarrativeSelectionDecision = {
	winnerIndex: 0 | 1 | 2;
	why?: string;
	// Optional: if consolidation was requested, we keep the merged/improved narrative
	consolidated?: {
		heading: string;
		paragraphs?: string[];
		bullets?: string[];
		include_code?: boolean;
	};
};

// ---- Inner write-pages pipeline state types (composable) --------------------

export type PageInit = {
	/** Outer document and current page/context. */
	doc: PagesContextOutput;
	page: WikiPage;
	pc: PageContext;
};

export type PageScored = PageInit & {
	/** Sorted top-N files by relevance for this page. */
	preferredFiles: string[];
};

export type PageHeaded = PageScored & {
	headings: OutlineHeadings; // { pageId, lead, sections[{id,heading}] }
};

export type PagePlanned = PageHeaded & {
	plans: SectionPlan[]; // one plan per section
};

export type PageCoded = PagePlanned & {
	/** Winner (or consolidated) per sectionId. */
	codeBySection: Map<string, CodeCandidate>;
};

export type PageExplained = PageCoded & {
	/** Explanation per code candidateId. */
	codeExplById: Map<string, CodeExplanation>;
};

export type PageNarrated = PageExplained & {
	/** Best narrative per sectionId. */
	narrativesBySection: Map<string, SectionCandidate>;
};

export type PageComposed = PageNarrated & {
	/** Final page markdown. */
	markdown: string;
};

/* ============================================================================
   LLM response shapes for stepWritePages (schema-driven)
	 ============================================================================ */

export type ScoreFilesOut = {
	scores: Array<{ filePath: string; score: number; why?: string }>;
};

export type HeadingsOut = {
	lead: string;
	sections: Array<{ id: string; heading: string }>;
};

export type PlanSectionOut = {
	must_cover: string[];
	code_need_score: number;
	expected_output?: string;
	primary_files: string[];
};

export type SingleCodeOut = {
	lang?: string;
	text: string;
	expected_output_alignment?: number;
	rationale?: string;
	sources?: string[];
};

export type SelectBetweenTwoOut = {
	winner: "A" | "B";
	why?: string;
	winner_alignment?: number;
};

export type ConsolidateCodeOut = { lang?: string; text: string };

export type ExplainCodeOut = { explanation: string; risks?: string[] };

export type SingleNarrativeOut = {
	heading: string;
	paragraphs?: string[];
	bullets?: string[];
	include_code?: boolean;
	sources?: string[];
};

export type ScoreNarrativesOut = {
	scores: Array<{ index: number; score: number; why?: string }>;
};

export type ConsolidateNarrativeOut = {
	heading: string;
	paragraphs?: string[];
	bullets?: string[];
	include_code?: boolean;
};

export type Step<I, O> = PipelineStep<I, O, Logger>;
