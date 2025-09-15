import type { Database } from "bun:sqlite";
import { createStarsService } from "@features/stars";
import type { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import * as starsLib from "@lib/stars";
import type { RepoInfo, StarList } from "@lib/types";
import { ConfigError } from "./public.types";
import {
	runListsCore,
	runReposCore,
	runStarsCore,
	runUnlistedCore,
} from "./stars";

/** Options for stars & lists fetch helpers. */
export interface StarsFetchOptions {
	logger?: typeof realLog;
	// NOTE: override token useful for tests / programmatic use
	GITHUB_TOKEN?: string;
	onProgress?: (e: {
		phase: string;
		index?: number;
		total?: number;
		item?: string;
	}) => void;
}

/** Resolve a GitHub token from override or environment (throws ConfigError when absent). */
function resolveToken(over?: string): string {
	if (over) return over;
	const v = Bun.env.GITHUB_TOKEN;
	if (!v)
		throw new ConfigError("GITHUB_TOKEN missing. Set env or pass override.");
	return v;
}

/** Fetch all lists as plain data (no disk writes, no logging unless logger provided). */
export async function fetchLists(
	opts: StarsFetchOptions = {},
): Promise<StarList[]> {
	const { GITHUB_TOKEN, onProgress } = opts;
	const token = resolveToken(GITHUB_TOKEN);
	const mod = await import("@lib/lists");
	// NOTE: streaming iteration used to emit progress events per list
	const out: StarList[] = [];
	let idx = 0;
	for await (const l of mod.getAllListsStream(token, undefined, {
		debug: () => {},
	})) {
		idx++;
		onProgress?.({ phase: "lists:fetch", index: idx, item: l.name });
		out.push(l);
	}
	return out;
}

/** Fetch repositories belonging to a single GitHub List by its name. */
export async function fetchReposFromList(
	listName: string,
	opts: StarsFetchOptions = {},
): Promise<RepoInfo[]> {
	const { logger, GITHUB_TOKEN } = opts;
	const token = resolveToken(GITHUB_TOKEN);
	if (!listName) throw new Error("listName required");
	const mod = await import("@lib/lists");
	const repos = await (logger?.withSpinner?.(
		`Fetching repos for ${listName}`,
		() => mod.getReposFromList(token, listName, undefined, { debug: () => {} }),
	) ?? mod.getReposFromList(token, listName, undefined, { debug: () => {} }));
	return repos;
}

/** Fetch all starred repositories (paginated) as pure data. */
export async function fetchStars(
	opts: StarsFetchOptions = {},
): Promise<RepoInfo[]> {
	const { GITHUB_TOKEN, onProgress } = opts;
	const token = resolveToken(GITHUB_TOKEN);
	const mod = await import("@lib/stars");
	const out: RepoInfo[] = [];
	let page = 0;
	for await (const batch of mod.getAllStarsStream(token, undefined, {
		debug: () => {},
	})) {
		page++;
		onProgress?.({ phase: "stars:page", index: page, item: `page-${page}` });
		out.push(...batch);
	}
	return out;
}

/** Compute stars not present in any locally ingested list (DB required). */
export async function fetchUnlistedStars(
	db?: Database,
	opts: StarsFetchOptions = {},
): Promise<RepoInfo[]> {
	const { logger } = opts;
	const svc = createStarsService(starsLib, withDB(db));
	const unlisted = await (logger?.withSpinner?.(
		"Computing unlisted stars",
		() => svc.read.getUnlistedStars(),
	) ?? svc.read.getUnlistedStars());
	return unlisted;
}

/** @deprecated Use fetchLists */
export const runLists = runListsCore as unknown as undefined;
/** @deprecated Use fetchReposFromList */
export const runRepos = runReposCore as unknown as undefined;
/** @deprecated Use fetchStars */
export const runStars = runStarsCore as unknown as undefined;
/** @deprecated Use fetchUnlistedStars */
export const runUnlisted = runUnlistedCore as unknown as undefined;
