// ── Types ─────────────────────────────────────────────────────────────────────

import type * as api from "./api";

export type RepoRef = { owner: string; name: string };

export type TopicMeta = {
	name: string;
	displayName?: string | null;
	shortDescription?: string | null;
	longDescriptionMd?: string | null;
	aliases?: string[]; // from explore front-matter
	related?: string[]; // from explore front-matter
	createdBy?: string | null;
	released?: string | null;
	wikipediaUrl?: string | null;
	logo?: string | null;
	isFeatured?: boolean;
};

export type TopicRow = {
	topic: string;
	display_name?: string | null;
	short_description?: string | null;
	long_description_md?: string | null;
	is_featured?: boolean;
	created_by?: string | null;
	released?: string | null;
	wikipedia_url?: string | null;
	logo?: string | null;
	updated_at?: string | null;
	etag?: string | null;
	aliases?: string[]; // from explore front-matter
	related?: string[]; // from explore front-matter
};

// Row type for statements that don't return rows
export type NoRow = Record<string, never>;
// GitHub /search/topics payload shapes
type TopicSearchItem = {
	name?: string;
	display_name?: string | null;
	short_description?: string | null;
	description?: string | null;
	aliases?: string[];
	featured?: boolean;
};
export type TopicSearchResponse = {
	items?: TopicSearchItem[];
};
export type RepoMini = {
	id: number;
	name_with_owner: string;
	is_archived: number;
};
export type Deps = {
	normalizeTopics: typeof api.normalizeTopics;
	reconcileRepoTopics: typeof api.reconcileRepoTopics;
	repoTopicsMany: typeof api.repoTopicsMany;
	selectStaleTopics: typeof api.selectStaleTopics;
	topicMetaMany: typeof api.topicMetaMany;
	upsertTopic: typeof api.upsertTopic;
	upsertTopicAliases: typeof api.upsertTopicAliases;
};
