import type { RepoRow } from "./lib/types";

export type IndexEntry = {
	name: string;
	description?: string | null;
	isPrivate: boolean;
	file: string;
};
/** Row & binding types */

export type IdRow = { id: number };

export type UpsertListBind = [
	name: string,
	description: string | null,
	is_private: number,
	slug: string,
];

export type LinkListRepoBind = [list_id: number, repo_id: number];

export type UpsertRepoBind = [
	name_with_owner: string,
	url: string,
	description: string | null,
	homepage_url: string | null,
	stars: number,
	forks: number,
	watchers: number,
	open_issues: number,
	open_prs: number,
	default_branch: string | null,
	last_commit_iso: string | null,
	last_release_iso: string | null,
	topics: string,
	primary_language: string | null,
	languages: string,
	license: string | null,
	is_archived: number,
	is_disabled: number,
	is_fork: number,
	is_mirror: number,
	has_issues_enabled: number,
	pushed_at: string | null,
	updated_at: string | null,
	created_at: string | null,
	disk_usage: number | null,
	readme_md: string | null,
	summary: string | null,
	tags: string,
	popularity: number,
	freshness: number,
	activeness: number,
];
export type ListRow = {
	id: number;
	name: string;
	description: string | null;
	slug: string;
	is_private: number;
};
export type ListDetail = {
	id: number;
	name: string;
	description: string | null;
};
export type Command = "lists" | "repos" | "dump" | "help";

export interface Parsed {
	command: Command;
	json: boolean;
	out?: string;
	dir?: string;
	list?: string;
	help: boolean;
	concurrency?: number;
}
/** Public API shape: decode JSON fields to native arrays */

export type ApiRepo = Omit<RepoRow, "tags"> & { tags: string[] };
