import type { RepoRow } from "@lib/types";
import type { ScoreItem } from "./llm";

export type ResumeFlag = number | "last" | undefined;

export type BatchSelector = { limit?: number; listSlug?: string };

export type RunOptions = { dry?: boolean; notes?: string; resume?: ResumeFlag };

export type Thresholds = {
	addBySlug?: Record<string, number>;
	defaultAdd?: number;
	remove?: number;
	preserve?: Set<string>;
};

export type PlanResult = {
	planned: string[];
	add: string[];
	remove: string[];
	keep: string[];
	review: string[];
};

export type ApplyPolicy = {
	thresholds?: Thresholds;
	avoidListless?: boolean; // ensure at least one list by falling back to top review
	minStars?: number; // block apply below this
};

export type PlanMembershipResult = PlanResult & {
	finalPlanned: string[];
	changed: boolean;
	blocked: boolean;
	blockReason?: string;
	fallbackUsed?: { list: string; score: number } | null;
};

export type ScoringService = {
	// run management
	getLastRunId(): number | null;
	createRun(notes?: string): number;
	resolveRunContext(opts: {
		dry: boolean;
		notes?: string;
		resume?: ResumeFlag;
	}): {
		runId: number | null;
		filterRunId: number | null;
	};

	// selection
	selectRepos(sel: BatchSelector, filterRunId: number | null): RepoRow[];

	// persistence
	persistScores(runId: number, repoId: number, scores: ScoreItem[]): void;

	// planning
	planTargets(
		current: string[],
		scores: ScoreItem[],
		cfg?: Thresholds,
	): PlanResult;
	planMembership(
		repo: RepoRow,
		current: string[],
		scores: ScoreItem[],
		policy?: ApplyPolicy,
	): PlanMembershipResult;
};
export type MaybeOllama =
	| {
			generatePromptAndSend: (
				system: string,
				user: string,
				opts?: { schema?: unknown },
			) => Promise<unknown>;
	  }
	| {
			send: (
				system: string,
				user: string,
				opts?: { schema?: unknown },
			) => Promise<unknown>;
	  }; // Prepared queries mirror current cli-scorer selection with resume filtering
export type BindRunLimit = [
	runIdNullCheck: number | null,
	runIdForExists: number | null,
	limit: number,
];
export type BindSlugRunLimit = [
	slug: string,
	runIdNullCheck: number | null,
	runIdForExists: number | null,
	limit: number,
];
