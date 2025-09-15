// ./api/types.ts
import type { Database } from "bun:sqlite";

/* -------------------------------------------------------------------------- */
/*  SPINNER                                                                   */
/* -------------------------------------------------------------------------- */

/** Canonical spinner instance. */
export type Spinner = {
	/** Current status text (mutable by caller). */
	text: string;
	/** Mark success and freeze this spinner line. */
	succeed(msg: string): void;
	/** Mark failure (optional on some loggers; keep optional). */
	fail?(msg: string): void;
	/** Stop without marking success/fail. */
	stop(): void;
};

/** Factory returned by logger.spinner(text). */
export type SpinnerFactory = { start(): Spinner };

/* Back-compat aliases (so existing imports keep working). */
export type SpinnerHandle = Spinner;
export type SpinnerController = SpinnerFactory;

/* -------------------------------------------------------------------------- */
/*  LOGGER                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Canonical logger contract used across CLI scripts.
 * Matches `typeof realLog` where relevant, but kept structural for tests.
 */
export type LoggerLike = {
	/* Headlines / sections */
	header(msg: string): void;

	/* Standard output; allow variadic like real logger (URL: value, etc.). */
	info(...args: unknown[]): void;

	/* Success line */
	success(msg: string): void;

	/* Optional warning / error, present on real logger */
	warn?(msg: string): void;
	error?(msg: string): void;

	/* Blank or text line */
	line(msg?: string): void;

	/* Pretty printers optionally present on real logger */
	json?(v: unknown): void;
	columns?(
		rows: Array<Record<string, unknown>>,
		order?: string[],
		headers?: Record<string, string>,
	): void;

	/* Spinners */
	spinner(text: string): SpinnerFactory;

	/* Convenience wrapper many scripts use */
	withSpinner<T>(text: string, fn: () => T | Promise<T>): Promise<T>;
};

/* For test scaffolding where you only stub a subset; prefer LoggerLike. */
export type TestLoggerLike = LoggerLike;

/* -------------------------------------------------------------------------- */
/*  FEATURE OPTIONS                                                           */
/* -------------------------------------------------------------------------- */

export type EnrichOptions = {
	onlyActive?: boolean;
	ttlDays?: number;
};

export type SummariseBatchOpts = {
	resummarise?: boolean;
};

/* -------------------------------------------------------------------------- */
/*  STARS / LISTS STREAMING INDEX SHAPES                                      */
/* -------------------------------------------------------------------------- */

export type StarListIndexItem = {
	listId: string;
	name: string;
	description: string | null;
	isPrivate: boolean;
	count: number;
	file: string;
};

export type StarsIndexPageItem = {
	file: string;
	count: number;
};

/* -------------------------------------------------------------------------- */
/*  SCORING                                                                   */
/* -------------------------------------------------------------------------- */

export type FreshnessSources = {
	pushed_at?: string | null;
	last_commit_iso?: string | null;
	last_release_iso?: string | null;
	updated_at?: string | null;
};

export type PlanDisplay = {
	add: string[];
	remove: string[];
	review: string[];
	fallbackUsed?: { list: string; score: number } | null;
};

export type ListlessCsvRow = {
	nameWithOwner: string;
	url: string;
	current: string[];
	scores: string; // JSON string
	note: string;
};

export type ProcessRepoOptions = {
	repo: import("@lib/types").RepoRow;
	idx?: number;
	total?: number;
	apply: boolean;
	runId: number | null;
	scoring: ReturnType<typeof import("@features/scoring").createScoringService>;
	listsSvc: ReturnType<typeof import("@features/lists").createListsService>;
	token: string;
	lists: import("@features/scoring/llm").ListDef[];
	svc: import("@features/scoring/llm").ScoringLLM;
};

/* -------------------------------------------------------------------------- */
/*  INGEST                                                                    */
/* -------------------------------------------------------------------------- */

export type IngestReturn = {
	lists: number;
	reposFromLists: number;
	unlisted: number;
};

export type IngestTotals = { lists: number; repos: number };

/* -------------------------------------------------------------------------- */
/*  DB (handy in places that accept injected DBs)                              */
/* -------------------------------------------------------------------------- */

export type DBLike = Database | undefined;
