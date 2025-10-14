import type { Database } from "bun:sqlite";
import { createStarsService } from "@features/stars";
import type { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import type { RepoInfo, StarList } from "@lib/types";
import { slugify } from "@lib/utils";
import {
	type ProgressDetail,
	type ProgressEmitter,
	resolveGithubToken,
} from "./public.types";

/** Options for stars & lists fetch helpers. */
export interface StarsFetchOptions {
	logger?: typeof realLog;
	// NOTE: override token useful for tests / programmatic use
	GITHUB_TOKEN?: string;
	onProgress?: ProgressEmitter<"fetching:lists" | "fetching:stars">;
}

export type StarListSummary = StarList & { slug: string };

export interface ListsFetchResult {
	items: StarListSummary[];
	stats: { count: number; fetchedAt: string };
}

export interface ListReposFetchResult {
	listName: string;
	listSlug: string;
	listId?: string;
	items: RepoInfo[];
	stats: { count: number; fetchedAt: string };
}

export interface StarsFetchResult {
	items: RepoInfo[];
	stats: { count: number; pages: number; fetchedAt: string };
}

export interface UnlistedStarsResult {
	items: RepoInfo[];
	stats: { count: number; fetchedAt: string };
}

/** Fetch all lists as plain data (no disk writes, no logging unless logger provided). */
export async function fetchLists(
	opts: StarsFetchOptions = {},
): Promise<ListsFetchResult> {
	const { GITHUB_TOKEN, onProgress } = opts;
	const token = resolveGithubToken({
		override: GITHUB_TOKEN,
		help: "Set GITHUB_TOKEN or pass options.GITHUB_TOKEN to fetch lists.",
	});
	const mod = await import("@lib/lists");
	// NOTE: streaming iteration used to emit progress events per list
	const out: StarListSummary[] = [];
	let idx = 0;
	for await (const l of mod.getAllListsStream(token, undefined, {
		debug: () => {},
	})) {
		idx++;
		const slug = slugify(l.name);
		const detail: ProgressDetail = {
			status: "progress",
			current: idx,
			label: l.name,
		};
		await onProgress?.({
			phase: "fetching:lists",
			index: idx,
			item: l.name,
			detail,
			meta: { slug },
		});
		out.push({ ...l, slug });
	}
	return {
		items: out,
		stats: { count: out.length, fetchedAt: new Date().toISOString() },
	};
}

/** Fetch repositories belonging to a single GitHub List by its name. */
export async function fetchReposFromList(
	listName: string,
	opts: StarsFetchOptions = {},
): Promise<ListReposFetchResult> {
	const { logger, GITHUB_TOKEN } = opts;
	const token = resolveGithubToken({
		override: GITHUB_TOKEN,
		help: "Set GITHUB_TOKEN or pass options.GITHUB_TOKEN to fetch list repositories.",
	});
	if (!listName) throw new Error("listName required");
	const mod = await import("@lib/lists");
	const repos = await (logger?.withSpinner?.(
		`Fetching repos for ${listName}`,
		() => mod.getReposFromList(token, listName, undefined, { debug: () => {} }),
	) ?? mod.getReposFromList(token, listName, undefined, { debug: () => {} }));
	let listId: string | undefined;
	try {
		const metas = await mod.collectListMetas(token, undefined, {
			debug: () => {},
		});
		listId = metas.find((m) => m.name === listName)?.listId;
	} catch (error) {
		// Ignore metadata lookup failures; callers still receive slug for joins.
		logger?.error?.(
			error instanceof Error ? error.message : String(error),
			"collectListMetas failed",
		);
	}
	const listSlug = slugify(listName);
	return {
		listName,
		listSlug,
		listId,
		items: repos,
		stats: { count: repos.length, fetchedAt: new Date().toISOString() },
	};
}

/** Fetch all starred repositories (paginated) as pure data. */
export async function fetchStars(
	opts: StarsFetchOptions = {},
): Promise<StarsFetchResult> {
	const { GITHUB_TOKEN, onProgress } = opts;
	const token = resolveGithubToken({
		override: GITHUB_TOKEN,
		help: "Set GITHUB_TOKEN or pass options.GITHUB_TOKEN to fetch stars.",
	});
	const mod = await import("@lib/stars");
	const out: RepoInfo[] = [];
	let page = 0;
	for await (const batch of mod.getAllStarsStream(token, undefined, {
		debug: () => {},
	})) {
		page++;
		const detail: ProgressDetail = { status: "page", page };
		await onProgress?.({
			phase: "fetching:stars",
			index: page,
			item: `page-${page}`,
			detail,
			meta: { count: batch.length },
		});
		out.push(...batch);
	}
	return {
		items: out,
		stats: {
			count: out.length,
			pages: page,
			fetchedAt: new Date().toISOString(),
		},
	};
}

/** Compute stars not present in any locally ingested list (DB required). */
export async function fetchUnlistedStars(
	db?: Database,
	opts: StarsFetchOptions = {},
): Promise<UnlistedStarsResult> {
	const { logger } = opts;
	const svc = createStarsService({ db: withDB(db) });
	const unlisted = await (logger?.withSpinner?.(
		"Computing unlisted stars",
		() => svc.read.getUnlistedStars(),
	) ?? svc.read.getUnlistedStars());
	return {
		items: unlisted,
		stats: { count: unlisted.length, fetchedAt: new Date().toISOString() },
	};
}
