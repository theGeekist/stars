// src/lib/types/repo.ts
// Consolidated repository types

import type { BaseRepoMeta, BaseRow, RepoIdentifiers } from "./base";

/** Core repository row as stored in database */
export type RepoRow = BaseRow &
	RepoIdentifiers &
	BaseRepoMeta & {
		license?: string | null;
		tags?: string | null;
		summary?: string | null;
		updates_json?: string | null;
		is_archived: number;
		is_disabled: number;
		popularity?: number | null;
		freshness?: number | null;
		activeness?: number | null;
		// Additional fields used by stars feature
		pushed_at?: string | null;
		last_commit_iso?: string | null;
		last_release_iso?: string | null;
	};

/** Enhanced repo info with additional GitHub metadata */
export type RepoInfo = {
	repoId: string;
	nameWithOwner: string;
	url: string;
	description?: string | null;
	homepageUrl?: string | null;
	stars: number;
	forks: number;
	watchers: number;
	openIssues: number;
	openPRs: number;
	defaultBranch?: string | null;
	lastCommitISO?: string | boolean;
	lastRelease?: {
		tagName?: string | null;
		publishedAt?: string | null;
		url?: string | null;
	} | null;
	topics: string[];
	primaryLanguage?: string | null;
	languages: { name: string; bytes: number }[];
	license?: string | null;
	isArchived: boolean;
	isDisabled: boolean;
	isFork: boolean;
	isMirror: boolean;
	hasIssuesEnabled: boolean;
	pushedAt: string;
	updatedAt: string;
	createdAt: string;
	diskUsage?: number | null;
	updates?: RepoUpdatesMetadata | null;
};

/** Update tracking metadata */
export type UpdateSourceType =
	| "release"
	| "changelog"
	| "discussion"
	| "commit";

export type UpdateCandidate = {
	type: UpdateSourceType;
	confidence: number;
	data?: Record<string, unknown>;
};

export type RepoUpdatesMetadata = {
	preferred: UpdateSourceType | null;
	candidates: UpdateCandidate[];
};
