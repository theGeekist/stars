// src/features/lists/ops.ts

import { tx } from "@features/db";
import type { GhExec, RepoInfo, StarList } from "@lib/types";
import * as gh from "./services";
import type { Stmts } from "./statements";
import type { BatchSelector, RepoRow } from "./types";

/* DB reads */

export async function getReposToScore(
	stmts: Stmts,
	sel: BatchSelector,
): Promise<RepoRow[]> {
	const limit = Math.max(1, Number(sel.limit ?? 10));
	return sel.listSlug
		? stmts.qReposBySlug.all(sel.listSlug, limit)
		: stmts.qReposDefault.all(limit);
}

export async function currentMembership(
	stmts: Stmts,
	repoId: number,
): Promise<string[]> {
	return stmts.qCurrentMembership
		.all(repoId)
		.map((r) => r.slug ?? "")
		.filter(Boolean);
}

export async function mapSlugsToGhIds(
	stmts: Stmts,
	slugs: string[],
): Promise<string[]> {
	const out: string[] = [];
	for (const s of slugs) {
		const row = stmts.qListIdBySlug.get(s);
		if (row) out.push(row.id); // Already a GitHub global ID string
	}
	return out;
}

/* GH composition (stream-first) */

export async function* getAllListsStream(
	token: string,
	pageSize = 25,
	exec?: GhExec,
): AsyncGenerator<StarList, void, void> {
	yield* gh.getAllListsStream(token, pageSize, exec);
}

export async function getReposFromList(
	token: string,
	listName: string,
	pageSize = 25,
	exec?: GhExec,
): Promise<RepoInfo[]> {
	const target = listName.toLowerCase();
	let previousEdge: string | null = null;
	for await (const edges of gh.streamListsEdges(token, exec)) {
		for (const edge of edges) {
			if (edge.node.name.toLowerCase() === target) {
				return gh.fetchListItems(
					token,
					previousEdge,
					edge.node.name,
					pageSize,
					exec,
				);
			}
			previousEdge = edge.cursor;
		}
	}
	throw new Error(`List not found: ${listName}`);
}

export async function getUnlistedStars(
	stmts: Stmts,
	token: string,
	exec?: GhExec,
) {
	const listed = new Set(stmts.qListedRepoIds.all().map((r) => r.repo_id));
	return gh.getUnlistedStarsFromGh(token, listed, exec);
}

/* Mutations */

export async function reconcileLocal(
	stmts: Stmts,
	repoId: number,
	slugs: string[],
): Promise<void> {
	tx(() => {
		for (const slug of slugs) stmts.insertListRepo.run(slug, repoId);
		const del = stmts.makeDeleteOther(slugs);
		del.run(repoId, ...slugs);
	}, stmts.db);
}

export async function updateOnGitHub(
	token: string,
	repoGlobalId: string,
	listIds: string[],
	exec?: GhExec,
): Promise<void> {
	await gh.updateRepoListsOnGitHub(token, repoGlobalId, listIds, exec);
}

/* Id helpers (new schema) */

export async function ensureListGhIds(
	stmts: Stmts,
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const r of stmts.qListKeyId.all()) {
		const key = (r.slug ?? r.name).toLowerCase();
		out.set(key, r.id);
	}
	return out;
}

export async function ensureRepoGhId(
	stmts: Stmts,
	repoId: string,
): Promise<string> {
	const row = stmts.qRepoLookup.get(repoId);
	if (!row) throw new Error(`Repo not found id=${repoId}`);
	return row.id; // already GH node id
}
