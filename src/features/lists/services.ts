// src/features/lists/services.ts

import { REPO_CORE_FRAGMENT } from "@lib/fragments";
import { gql, makeRunner } from "@lib/github";
import { mapListRepoNodeToRepoInfo } from "@lib/mapper";
import type {
	GhExec,
	ListItemsAtEdge,
	ListsEdgesPage,
	RepoInfo,
	StarList,
	ViewerStarIds,
} from "@lib/types";
import type { ItemNode, ListEdge, ListNodeWithItems } from "./types";

/* ─────────── Queries ─────────── */

export const LISTS_EDGES_PAGE = gql`
  query ListsEdgesPage($after: String) {
    viewer {
      lists(first: 20, after: $after) {
        pageInfo { endCursor hasNextPage }
        edges { cursor node { listId: id name description isPrivate } }
      }
    }
  }
`;

export const LIST_ITEMS_AT_EDGE = gql`
  ${REPO_CORE_FRAGMENT}
  query ListItemsAtEdge($listAfter: String, $itemsAfter: String, $pageSize: Int!) {
    viewer {
      lists(first: 1, after: $listAfter) {
        nodes {
          name
          items(first: $pageSize, after: $itemsAfter) {
            pageInfo { endCursor hasNextPage }
            nodes { __typename ... on Repository { ...RepoCore repoId: id } }
          }
        }
      }
    }
  }
`;

/** Minimal page for “unlisted stars” */
export const VIEWER_STAR_IDS = gql`
  query ViewerStarIds($after: String) {
    viewer {
      starredRepositories(
        first: 100, after: $after,
        orderBy: { field: STARRED_AT, direction: DESC }
      ) {
        pageInfo { endCursor hasNextPage }
        edges { node { id nameWithOwner } }
      }
    }
  }
`;

/** Mutation: update repo’s list membership on GitHub */
export const M_UPDATE_LISTS_FOR_ITEM = gql`
  mutation UpdateUserListsForItem($itemId: ID!, $listIds: [ID!]!) {
    updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
      lists { id name }
    }
  }
`;

/* ─────────── Runners (bind once; allow test injection) ─────────── */

const runListsEdgesPageDefault = makeRunner(LISTS_EDGES_PAGE);
const runListItemsAtEdgeDefault = makeRunner(LIST_ITEMS_AT_EDGE);
const runViewerStarIdsDefault = makeRunner(VIEWER_STAR_IDS);
const runUpdateListsForItemDefault = makeRunner(M_UPDATE_LISTS_FOR_ITEM);

function bind(exec?: GhExec) {
	return {
		runListsEdgesPage: exec
			? makeRunner(LISTS_EDGES_PAGE, exec)
			: runListsEdgesPageDefault,
		runListItemsAtEdge: exec
			? makeRunner(LIST_ITEMS_AT_EDGE, exec)
			: runListItemsAtEdgeDefault,
		runViewerStarIds: exec
			? makeRunner(VIEWER_STAR_IDS, exec)
			: runViewerStarIdsDefault,
		runUpdateListsForItem: exec
			? makeRunner(M_UPDATE_LISTS_FOR_ITEM, exec)
			: runUpdateListsForItemDefault,
	};
}

/* ─────────── Pagers / helpers (GH-only) ─────────── */

export async function* streamListsEdges(
	token: string,
	exec?: GhExec,
): AsyncGenerator<ListEdge[], void, void> {
	let after: string | null = null;
	const { runListsEdgesPage } = bind(exec);
	while (true) {
		const data = (await runListsEdgesPage(token, { after })) as ListsEdgesPage;
		const page = data.viewer.lists;
		yield page.edges;
		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor;
	}
}

export async function fetchListItems(
	token: string,
	listEdgeCursorBefore: string | null,
	listNameForLogs: string,
	pageSize = 25,
	exec?: GhExec,
): Promise<RepoInfo[]> {
	const { runListItemsAtEdge } = bind(exec);
	const repos: RepoInfo[] = [];
	let itemsAfter: string | null = null;

	while (true) {
		const data = (await runListItemsAtEdge(token, {
			listAfter: listEdgeCursorBefore,
			itemsAfter,
			pageSize,
		})) as ListItemsAtEdge;
		const listNode: ListNodeWithItems | undefined = data.viewer.lists.nodes[0];
		if (!listNode) {
			throw new Error(
				`List node not found at edge=${String(listEdgeCursorBefore)} (hint: ${listNameForLogs})`,
			);
		}

		for (const n of listNode.items.nodes as ItemNode[]) {
			const mapped = mapListRepoNodeToRepoInfo(n);
			if (mapped) repos.push(mapped);
		}

		if (!listNode.items.pageInfo.hasNextPage) break;
		itemsAfter = listNode.items.pageInfo.endCursor;
	}
	return repos;
}

/** Stream viewer stars (id + nameWithOwner), no DB involved. */
export async function* streamViewerStars(
	token: string,
	exec?: GhExec,
): AsyncGenerator<
	Array<{ repoId: string; nameWithOwner: string }>,
	void,
	void
> {
	const { runViewerStarIds } = bind(exec);
	let after: string | null = null;
	while (true) {
		const data = (await runViewerStarIds(token, { after })) as ViewerStarIds;
		const page = data.viewer.starredRepositories;
		yield page.edges.map(
			(e: { node: { id: string; nameWithOwner: string } }) => ({
				repoId: e.node.id,
				nameWithOwner: e.node.nameWithOwner,
			}),
		);
		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor;
	}
}

/** Update list membership for a repo on GitHub. */
export async function updateRepoListsOnGitHub(
	token: string,
	repoGlobalId: string,
	listIds: string[],
	exec?: GhExec,
): Promise<void> {
	const { runUpdateListsForItem } = bind(exec);
	await runUpdateListsForItem(token, { itemId: repoGlobalId, listIds });
}

/* ─────────── High-level GH-only APIs (no DB) ─────────── */

function metaFromEdge(edgeBefore: string | null, edge: ListEdge) {
	return {
		edgeBefore,
		listId: edge.node.listId,
		name: edge.node.name,
		description: edge.node.description ?? null,
		isPrivate: edge.node.isPrivate,
	} as const;
}

export async function* getAllListsStream(
	token: string,
	pageSize = 25,
	exec?: GhExec,
): AsyncGenerator<StarList, void, void> {
	let previousEdgeCursor: string | null = null;

	for await (const edges of streamListsEdges(token, exec)) {
		for (const edge of edges) {
			const meta = metaFromEdge(previousEdgeCursor, edge);
			const repos = await fetchListItems(
				token,
				meta.edgeBefore,
				meta.name,
				pageSize,
				exec,
			);
			yield {
				listId: meta.listId,
				name: meta.name,
				description: meta.description ?? undefined,
				isPrivate: meta.isPrivate,
				repos,
			};
			previousEdgeCursor = edge.cursor;
		}
	}
}

/** “Unlisted stars” = GH stars – locally listed ids (provided). */
export async function getUnlistedStarsFromGh(
	token: string,
	listedIds: Set<string>,
	exec?: GhExec,
): Promise<Array<{ repoId: string; nameWithOwner: string }>> {
	const out: Array<{ repoId: string; nameWithOwner: string }> = [];
	for await (const batch of streamViewerStars(token, exec)) {
		for (const r of batch) if (!listedIds.has(r.repoId)) out.push(r);
	}
	return out;
}
