// src/lib/types/index.ts
// Main types export - consolidate all type exports here

export type { BatchSelector } from "./base";
// Base types
export * from "./base";
export * from "./graphql";
export type { StarList } from "./lists";
export * from "./lists";
// Legacy re-exports to maintain compatibility
export type { RepoInfo, RepoRow } from "./repo";
export * from "./repo";

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
