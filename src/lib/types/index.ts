// src/lib/types/index.ts
// Main types export - consolidate all type exports here

// Re-export all types for easy importing
export type {
	BaseCliOptions,
	BaseRepoMeta,
	BaseRow,
	BatchSelector,
	CoreRepoFields,
	GitHubNode,
	GitHubRepoFields,
	ISODateTime,
	PageInfo,
	RepoIdentifiers,
	RepoMetaFields,
	RepoStatsFields,
	RepoStatusFields,
	RepoTimestampFields,
} from "./base";
// Base types
export * from "./base";
// Database types
export type {
	BindIdLimit,
	BindLimit,
	BindSlugLimit,
	IdRow,
	ListedRepoIdRow,
	ListIdRow,
	ListKeyIdRow,
	ListListIdRow,
	ListSlugRow,
	NameRow,
	NoRow,
	RepoIdLookupRow,
	SlugRow,
	StringIdRow,
	UrlRow,
} from "./database";
export * from "./database";
export * from "./graphql";
export type { StarList } from "./lists";
export * from "./lists";
// Legacy re-exports to maintain compatibility
export type { RepoInfo, RepoRow } from "./repo";
export * from "./repo";
// Service interfaces
export type { ListsApplyApi, ListsReadApi, ListsService } from "./services";
export * from "./services";
// Utility types
export type {
	Logger,
	LoggerLike,
	NoopReporter,
	Reporter,
	TestLoggerLike,
} from "./utilities";
export * from "./utilities";

// Additional types that don't fit in other categories
export type ChunkingOptions = {
	chunkSizeTokens?: number;
	chunkOverlapTokens?: number;
	mode?: "sentence" | "token";
};

export type ReadmeRow = {
	id: number;
	readme_md: string | null;
	readme_etag: string | null;
};

export type ListsConfig = {
	pageSize: number;
	concurrency: number;
	debug: boolean;
};

export type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export type GhExec = (
	token: string,
	queryOrDoc: string | { query?: string; doc?: string },
	vars?: Record<string, unknown>,
) => Promise<unknown>;
