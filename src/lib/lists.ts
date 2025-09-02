// src/lib/lists.ts
import { githubGraphQL, gql } from "./github.js";
import type {
	ListItemsAtEdge,
	ListsConfig,
	ListsEdgesPage,
	RepoInfo,
	StarList,
} from "./types.js";

/* Reporter interface */
export type ListsReporter = {
	debug: (...args: unknown[]) => void;
};
const NoopReporter: ListsReporter = { debug: () => {} };

function resolveConfig(
	env: Record<string, string | undefined> = Bun.env,
): ListsConfig {
	const pageSize = Math.max(
		10,
		Math.min(100, Number(env.LISTS_PAGE_SIZE ?? 25)),
	);
	const concurrency = Number(env.LISTS_CONCURRENCY ?? 3);
	// keep for compatibility, but we won’t write directly to console anymore
	const debug = !!env.DEBUG;
	return { pageSize, concurrency, debug };
}

// ──────────────────────────────── queries ──────────────────────────────────

export const Q_REPO_ID = gql`
  query RepoId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id }
  }
`;

export const M_UPDATE_LISTS_FOR_ITEM = gql`
  mutation UpdateUserListsForItem($itemId: ID!, $listIds: [ID!]!) {
    updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
      lists { id name }
    }
  }
`;

// 1) Page viewer.lists to collect edge cursors (metadata)
export const LISTS_EDGES_PAGE = gql`
  query ListsEdgesPage($after: String) {
    viewer {
      lists(first: 20, after: $after) {
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          cursor
          node {
						listId: id
            name
            description
            isPrivate
          }
        }
      }
    }
  }
`;

// 2) Select exactly one list (the one *after* edgeBefore) and page its items.
export const LIST_ITEMS_AT_EDGE = gql`
  query ListItemsAtEdge(
    $listAfter: String
    $itemsAfter: String
    $pageSize: Int!
  ) {
    viewer {
      lists(first: 1, after: $listAfter) {
        nodes {
          name
          items(first: $pageSize, after: $itemsAfter) {
            pageInfo {
              endCursor
              hasNextPage
            }
            nodes {
              __typename
              ... on Repository {
                repoId: id
                nameWithOwner
                url
                description
                homepageUrl
                stargazerCount
                forkCount
                issues(states: OPEN) {
                  totalCount
                }
                pullRequests(states: OPEN) {
                  totalCount
                }
                defaultBranchRef {
                  name
                  target {
                    ... on Commit {
                      committedDate
                    }
                  }
                }
                primaryLanguage {
                  name
                }
                licenseInfo {
                  spdxId
                }
                isArchived
                isDisabled
                isFork
                isMirror
                hasIssuesEnabled
                pushedAt
                updatedAt
                createdAt
                repositoryTopics(first: 50) {
                  nodes {
                    topic {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ─────────────────────────────── internals ─────────────────────────────────

// Small pure helper to convert a GraphQL node into our RepoInfo shape
export function mapRepoNodeToRepoInfo(
	n: ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number],
): RepoInfo | null {
	if (!n || n.__typename !== "Repository") return null;

	const topics: string[] =
		n.repositoryTopics?.nodes
			?.map((x) => x.topic?.name)
			.filter((s): s is string => !!s) ?? [];

	return {
		repoId: n.repoId ?? null,
		nameWithOwner: n.nameWithOwner ?? "",
		url: n.url ?? "",
		description: n.description ?? null,
		homepageUrl: n.homepageUrl ?? null,

		stars: n.stargazerCount ?? 0,
		forks: n.forkCount ?? 0,
		watchers: 0,

		openIssues: n.issues?.totalCount ?? 0,
		openPRs: n.pullRequests?.totalCount ?? 0,

		defaultBranch: n.defaultBranchRef?.name ?? null,
		lastCommitISO:
			(n.defaultBranchRef?.target &&
				"committedDate" in n.defaultBranchRef.target &&
				(n.defaultBranchRef.target as { committedDate?: string })
					.committedDate) ??
			undefined,

		lastRelease: null,
		topics,
		primaryLanguage: n.primaryLanguage?.name ?? null,
		languages: [],

		license: n.licenseInfo?.spdxId ?? null,

		isArchived: !!n.isArchived,
		isDisabled: !!n.isDisabled,
		isFork: !!n.isFork,
		isMirror: !!n.isMirror,
		hasIssuesEnabled: !!n.hasIssuesEnabled,

		pushedAt: n.pushedAt ?? "",
		updatedAt: n.updatedAt ?? "",
		createdAt: n.createdAt ?? "",

		diskUsage: null,
	} as RepoInfo;
}

/** Fetch all items for a list identified by the cursor *before* it (edgeBefore). */
async function fetchAllItemsAtEdge(
	token: string,
	listEdgeCursorBefore: string | null,
	listNameForLogs: string,
	gh: typeof githubGraphQL = githubGraphQL,
	pageSize = 25,
	reporter: ListsReporter = NoopReporter,
): Promise<RepoInfo[]> {
	const { debug } = reporter;
	const repos: RepoInfo[] = [];
	let itemsAfter: string | null = null;
	let pageNo = 0;

	debug(
		`items: start list="${listNameForLogs}" edgeBefore=${JSON.stringify(
			listEdgeCursorBefore,
		)} pageSize=${pageSize}`,
	);

	type ListNode = ListItemsAtEdge["viewer"]["lists"]["nodes"][number];
	type ItemNode =
		ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number];

	// eslint-disable-next-line no-constant-condition
	while (true) {
		pageNo++;
		debug(
			`items: query page #${pageNo} list="${listNameForLogs}" itemsAfter=${JSON.stringify(
				itemsAfter,
			)}`,
		);

		const data: ListItemsAtEdge = await gh<ListItemsAtEdge>(
			token,
			LIST_ITEMS_AT_EDGE,
			{ listAfter: listEdgeCursorBefore, itemsAfter, pageSize },
		);

		const listNode: ListNode | undefined = data.viewer.lists.nodes[0];
		if (!listNode) {
			throw new Error(
				`List node not found at edge=${String(listEdgeCursorBefore)} (hint: ${listNameForLogs})`,
			);
		}

		const items = listNode.items;
		const before = repos.length;

		for (const n of items.nodes as ItemNode[]) {
			const mapped = mapRepoNodeToRepoInfo(n);
			if (mapped) repos.push(mapped);
		}

		debug(
			`items: page #${pageNo} got=${repos.length - before} total=${
				repos.length
			} hasNext=${items.pageInfo.hasNextPage} endCursor=${JSON.stringify(
				items.pageInfo.endCursor,
			)}`,
		);

		if (!items.pageInfo.hasNextPage) break;
		itemsAfter = items.pageInfo.endCursor;
	}

	debug(`items: done list="${listNameForLogs}" total=${repos.length}`);
	return repos;
}

/** small bounded parallel map */
async function pMap<T, R>(
	input: T[],
	concurrency: number,
	fn: (value: T, index: number) => Promise<R>,
	reporter: ListsReporter = NoopReporter,
): Promise<R[]> {
	const { debug } = reporter;
	const results: R[] = new Array(input.length) as R[];
	let i = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, input.length) },
		async (_, w) => {
			debug(`pMap: worker#${w} start`);
			for (;;) {
				const idx = i++;
				if (idx >= input.length) {
					debug(`pMap: worker#${w} done`);
					return;
				}
				debug(`pMap: worker#${w} running index=${idx}`);
				results[idx] = await fn(input[idx], idx);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

// ─────────────────────────────── public API ────────────────────────────────

export async function getAllLists(
	token: string,
	gh: typeof githubGraphQL = githubGraphQL,
	reporter: ListsReporter = NoopReporter,
): Promise<StarList[]> {
	const cfg = resolveConfig();
	const { debug } = reporter;

	debug("env:", {
		DEBUG: String(cfg.debug),
		LISTS_CONCURRENCY: String(cfg.concurrency),
		LISTS_PAGE_SIZE: String(cfg.pageSize),
	});

	const metas = await collectListMetas(token, gh, reporter);
	debug(
		`lists: collected metas=${metas.length}, concurrency=${cfg.concurrency}`,
	);

	const lists: StarList[] = await pMap(
		metas,
		cfg.concurrency,
		async (m, idx) => {
			debug(
				`list#${idx}: fetch items "${m.name}" edgeBefore=${JSON.stringify(m.edgeBefore)}`,
			);
			const repos: RepoInfo[] = await fetchAllItemsAtEdge(
				token,
				m.edgeBefore,
				m.name,
				gh,
				cfg.pageSize,
				reporter,
			);
			return {
				listId: m.listId,
				name: m.name,
				description: m.description,
				isPrivate: m.isPrivate,
				repos,
			};
		},
		reporter,
	);

	debug(`lists: done, total lists=${lists.length}`);
	return lists;
}

export async function collectListMetas(
	token: string,
	gh: typeof githubGraphQL = githubGraphQL,
	reporter: ListsReporter = NoopReporter,
): Promise<
	Array<{
		edgeBefore: string | null;
		listId: string;
		name: string;
		description: string | null;
		isPrivate: boolean;
	}>
> {
	const { debug } = reporter;
	type Meta = {
		edgeBefore: string | null;
		listId: string;
		name: string;
		description: string | null;
		isPrivate: boolean;
	};

	const metas: Meta[] = [];
	let after: string | null = null;
	let previousEdgeCursor: string | null = null;
	let pageNo = 0;

	debug("lists: begin paging metadata");
	for (;;) {
		pageNo++;
		debug(`lists: query page #${pageNo} after=${JSON.stringify(after)}`);

		const data: ListsEdgesPage = await gh<ListsEdgesPage>(
			token,
			LISTS_EDGES_PAGE,
			{ after },
		);

		const page = data.viewer.lists;
		debug(
			`lists: page #${pageNo} edges=${page.edges.length} hasNext=${
				page.pageInfo.hasNextPage
			} endCursor=${JSON.stringify(page.pageInfo.endCursor)}`,
		);

		for (const edge of page.edges) {
			metas.push({
				edgeBefore: previousEdgeCursor,
				listId: edge.node.listId,
				name: edge.node.name,
				description: edge.node.description ?? null,
				isPrivate: edge.node.isPrivate,
			});
			debug(
				`lists: push meta name="${edge.node.name}" edgeBefore=${JSON.stringify(
					previousEdgeCursor,
				)}`,
			);
			previousEdgeCursor = edge.cursor;
		}

		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor;
	}
	return metas;
}

export async function* getAllListsStream(
	token: string,
	gh: typeof githubGraphQL = githubGraphQL,
	reporter: ListsReporter = NoopReporter,
): AsyncGenerator<StarList, void, void> {
	const cfg = resolveConfig();

	let after: string | null = null;
	let previousEdgeCursor: string | null = null;

	for (;;) {
		const pageData: ListsEdgesPage = await gh<ListsEdgesPage>(
			token,
			LISTS_EDGES_PAGE,
			{ after },
		);

		const edges = pageData.viewer.lists.edges;

		for (const edge of edges) {
			const meta = {
				edgeBefore: previousEdgeCursor,
				listId: edge.node.listId,
				name: edge.node.name,
				description: edge.node.description ?? null,
				isPrivate: edge.node.isPrivate,
			};

			const repos = await fetchAllItemsAtEdge(
				token,
				meta.edgeBefore,
				meta.name,
				gh,
				cfg.pageSize,
				reporter,
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

		if (!pageData.viewer.lists.pageInfo.hasNextPage) break;
		after = pageData.viewer.lists.pageInfo.endCursor;
	}
}

export async function getReposFromList(
	token: string,
	listName: string,
	gh: typeof githubGraphQL = githubGraphQL,
	reporter: ListsReporter = NoopReporter,
): Promise<RepoInfo[]> {
	const cfg = resolveConfig();
	const { debug } = reporter;

	const target: string = listName.toLowerCase();
	let after: string | null = null;
	let previousEdgeCursor: string | null = null;
	let pageNo = 0;

	debug(`reposByName: search "${listName}"`);

	// eslint-disable-next-line no-constant-condition
	while (true) {
		pageNo++;
		debug(
			`reposByName: query lists page #${pageNo} after=${JSON.stringify(after)}`,
		);

		const data: ListsEdgesPage = await gh<ListsEdgesPage>(
			token,
			LISTS_EDGES_PAGE,
			{ after },
		);

		const { edges, pageInfo } = data.viewer.lists;

		for (const edge of edges) {
			debug(
				`reposByName: inspect name="${
					edge.node.name
				}" prevEdge=${JSON.stringify(previousEdgeCursor)}`,
			);
			if (edge.node.name.toLowerCase() === target) {
				debug(`reposByName: match "${edge.node.name}" → fetch items`);
				return fetchAllItemsAtEdge(
					token,
					previousEdgeCursor,
					edge.node.name,
					gh,
					cfg.pageSize,
					reporter,
				);
			}
			previousEdgeCursor = edge.cursor;
		}

		if (!pageInfo.hasNextPage) break;
		after = pageInfo.endCursor;
	}

	throw new Error(`List not found: ${listName}`);
}
