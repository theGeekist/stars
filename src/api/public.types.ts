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

import type { SummariseDeps } from "@features/summarise/types";
// Import for local use
import { createOllamaService } from "@jasonnathan/llm-core/ollama-service";
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
 * Lifecycle markers for progress events.
 * `page` covers paginated fetches, `progress` is a general counter update,
 * and `custom` enables feature-specific extensions when paired with `code`.
 */
export type ProgressStatus =
	| "start"
	| "page"
	| "progress"
	| "done"
	| "error"
	| "custom";

type ProgressDetailBase = { status: ProgressStatus } & Record<string, unknown>;

/**
 * Structured progress detail payload carried alongside phase/index metadata.
 * - `start`/`done` mark lifecycle boundaries.
 * - `page` reports pagination progress (current page & optional total).
 * - `progress` is a generic counter with optional label/context.
 * - `error` surfaces failures without throwing.
 * - `custom` allows feature-specific extensions via `code`.
 */
export type ProgressDetail =
	| (ProgressDetailBase & { status: "start" | "done" })
	| (ProgressDetailBase & { status: "page"; page: number; pages?: number })
	| (ProgressDetailBase & {
			status: "progress";
			current: number;
			total?: number;
			label?: string;
	  })
	| (ProgressDetailBase & { status: "error"; error: string })
	| (ProgressDetailBase & { status: "custom"; code: string })
	| ProgressDetailBase;

/**
 * Progress notification emitted by long‑running batch operations.
 * Phases follow a `verbing:subject` convention (e.g. `summarising:repo`, `ranking:repo`,
 * `fetching:stars`, `ingesting:lists`) so listeners can route by verb.
 */
export interface ProgressEvent {
	phase: string;
	index?: number;
	total?: number;
	repo?: string;
	item?: string;
	detail?: ProgressDetail;
	meta?: Record<string, unknown>;
}

/** Function signature for progress emitters used across public APIs. */
export type ProgressEmitter<TPhase extends string = string> = (
	event: ProgressEvent & { phase: TPhase },
) => void | Promise<void>;

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
	return createOllamaService({
		model: cfg.model,
		endpoint: cfg.host,
		apiKey: cfg.apiKey,
	});
}

/**
 * Create summarisation dependencies from a `ModelConfig`.
 * Shared helper so summarise.* exports don't duplicate adapter wiring.
 */
export function createSummariseDepsFromConfig(cfg: ModelConfig): SummariseDeps {
	const { gen } = require("@lib/ollama");
	return {
		gen: async (prompt: string, _opts?: Record<string, unknown>) => {
			const headers = cfg.apiKey
				? { Authorization: `Bearer ${cfg.apiKey}` }
				: undefined;
			return gen(prompt, { model: cfg.model, host: cfg.host, headers });
		},
	};
}

/**
 * Resolve a `ModelConfig` by merging overrides with environment defaults.
 * Throws when no model is available, ensuring consistent error semantics.
 */
export function resolveModelConfig(
	cfg?: ModelConfig,
	options: { help?: string } = {},
): ModelConfig {
	const { help } = options;
	const envModel = Bun.env.OLLAMA_MODEL;
	const envHost = Bun.env.OLLAMA_ENDPOINT ?? Bun.env.OLLAMA_HOST;
	const envKey = Bun.env.OLLAMA_API_KEY;
	const model = cfg?.model ?? envModel;
	if (model == null || model.trim() === "") {
		throw new ConfigError(
			help ??
				"OLLAMA_MODEL missing. Provide ModelConfig.model or set env OLLAMA_MODEL.",
		);
	}
	const host = cfg?.host ?? envHost;
	const apiKey = cfg?.apiKey ?? envKey;
	const cleanedHost = host?.trim() ?? "";
	const cleanedKey = apiKey?.trim() ?? "";
	return {
		model: model.trim(),
		host: cleanedHost ? cleanedHost : undefined,
		apiKey: cleanedKey ? cleanedKey : undefined,
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

/** Resolve a GitHub token from override/env while enforcing consistent errors. */
export function resolveGithubToken({
	override,
	required = true,
	help,
}: {
	override?: string;
	required?: boolean;
	help?: string;
} = {}): string {
	const candidate = override ?? Bun.env.GITHUB_TOKEN ?? "";
	if (candidate.trim().length === 0) {
		if (required) {
			throw new ConfigError(
				help ?? "GITHUB_TOKEN missing. Set env or pass override.",
			);
		}
		return "";
	}
	return candidate;
}
