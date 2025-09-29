/**
 * Shared public types & utilities used across summarising, ranking, stars and ingest modules.
 * NOTE: These are additive and kept backward compatible; deprecated fields are retained until the next major release.
 */

// Re-export core types from lib for public API consumers
export type {
	BatchSelector,
	ListDef,
	ListsApplyApi,
	ListsReadApi,
	ListsService,
	RepoInfo,
	StarList,
} from "@lib/types";

// Import for local use
import type { ListDef } from "@lib/types";

/* -------------------------------------------------------------------------- */
/*  ERROR HANDLING                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Thrown instead of exiting the process when required configuration (env vars, tokens) is missing.
 * Wrap public API calls and test via `instanceof ConfigError` to provide user-facing guidance.
 */
export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

/* -------------------------------------------------------------------------- */
/*  LISTS API TYPES                                                           */
/* -------------------------------------------------------------------------- */

/** Use shared ListDef as ListDefinition for backward compatibility */
export type ListDefinition = ListDef;

/* -------------------------------------------------------------------------- */
/*  PROGRESS & RESULTS                                                        */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  PROGRESS & RESULTS                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Progress notification emitted by long‑running batch operations.
 * Phases are domain prefixed (e.g. `summarising`, `ranking`, `lists:fetch`, `stars:page`, `ingest:*`).
 */
export interface ProgressEvent {
	phase: string;
	index?: number;
	total?: number;
	repo?: string;
	meta?: Record<string, unknown>;
}

export type OpStatus = "ok" | "error" | "skipped";

/** Result item for a single repository summary operation. */
export interface SummaryItemResult {
	repoId: number;
	nameWithOwner: string;
	paragraph?: string;
	words?: number;
	saved: boolean;
	status: OpStatus;
	error?: string;
}

/** Result item for a single repository ranking (categorisation) operation. */
export interface RankingItemResult {
	repoId: number;
	nameWithOwner: string;
	status: OpStatus;
	/** @deprecated Use scoresPersisted & membershipApplied */
	// NOTE: retained for backward compatibility; prefer explicit flags
	saved: boolean;
	error?: string;
	// optional metadata
	plannedLists?: string[]; // final planned list membership
	changed?: boolean;
	scores?: Array<{ list: string; score: number; why?: string }>;
	blocked?: boolean;
	blockReason?: string | null;
	fallbackUsed?: { list: string; score: number } | null;
	// New explicit flags
	scoresPersisted?: boolean;
	membershipApplied?: boolean;
}

/** Result slice for ingest operations (lists, unlisted, or combined runs). */
export interface IngestResultItem {
	type: "lists" | "unlisted" | "combined";
	status: OpStatus;
	counts: { lists?: number; reposFromLists?: number; unlisted?: number };
	error?: string;
}

/** Aggregated counters for a batch run. */
export interface BatchStats {
	processed: number;
	succeeded: number;
	failed: number;
	saved: number;
}

/** Wrapper holding all per-item results plus aggregate `stats`. */
export interface BatchResult<T> {
	items: T[];
	stats: BatchStats;
}

// LLM model configuration passed per request (avoids env reliance)
/**
 * Per-request model configuration overriding environment defaults.
 * Precedence (highest → lowest): explicit injected deps/llm > ModelConfig > environment variables.
 */
export interface ModelConfig {
	// NOTE: required to avoid accidental empty model invocation
	model: string;
	host?: string;
	// NOTE: adds Authorization bearer header when provided
	apiKey?: string;
}

// Narrow scoring LLM interface (re-export shape from scoring/llm)
/** Minimal generate function shape accepted by the scoring adapter. */
export type ScoringLLMGenerate = (
	system: string,
	user: string,
	opts?: { schema?: unknown },
) => Promise<unknown>;

/**
 * Create a lightweight scoring LLM adapter from a `ModelConfig`.
 * Attempts JSON parse of the raw response; falls back to raw string if parsing fails.
 */
export function createScoringLLMFromConfig(cfg: ModelConfig): {
	generatePromptAndSend: ScoringLLMGenerate;
} {
	// Lazy import to avoid pulling ollama if consumer provides custom llm
	const { gen } = require("@lib/ollama");
	return {
		async generatePromptAndSend(
			system: string,
			user: string,
			_opts?: { schema?: unknown },
		) {
			const prompt = `${system}\n\n${user}`.trim();
			// Pass model + host + headers to underlying generator; opts.schema ignored by raw gen
			const headers = cfg.apiKey
				? { Authorization: `Bearer ${cfg.apiKey}` }
				: undefined;
			const raw = await gen(prompt, {
				model: cfg.model,
				host: cfg.host,
				headers,
			});
			// Attempt to parse JSON output since scoring expects an object with scores
			try {
				return JSON.parse(raw);
			} catch {
				return raw; // fallback; validator will error leading to clear failure
			}
		},
	};
}

// Utility to build stats
/** Build aggregate stats from item statuses & their legacy `saved` flag. */
export function buildBatchStats<T extends { status: OpStatus; saved: boolean }>(
	items: T[],
): BatchStats {
	let succeeded = 0;
	let failed = 0;
	let saved = 0;
	for (const i of items) {
		if (i.status === "ok") succeeded++;
		else if (i.status === "error") failed++;
		if (i.saved) saved++;
	}
	return { processed: items.length, succeeded, failed, saved };
}

// Safe env accessor; throws ConfigError instead of exiting.
/**
 * Read an environment variable or throw a ConfigError with optional help text.
 * Avoids process termination for library consumers.
 */
export function getRequiredEnv(name: string, help?: string): string {
	const v = Bun.env[name];
	if (v == null || v.trim() === "") {
		throw new ConfigError(
			help ? `${name} missing. ${help}` : `${name} missing in environment`,
		);
	}
	return v;
}
