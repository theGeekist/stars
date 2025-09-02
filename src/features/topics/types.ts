// ── Types ─────────────────────────────────────────────────────────────────────

import type * as api from "./api";

export type RepoRef = { owner: string; name: string };

export type TopicMeta = {
	name: string;
	displayName?: string | null;
	shortDescription?: string | null;
	aliases?: string[];
	isFeatured?: boolean;
};

export type TopicRow = {
	topic: string;
	display_name?: string | null;
	short_description?: string | null;
	aliases?: string[] | null;
	is_featured?: boolean;
	updated_at?: string;
	etag?: string | null;
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
};
