// src/lib/lists.ts
import { githubGraphQL, gql } from "./github.js";
import type {
	ListItemsAtEdge,
	ListsEdgesPage,
	RepoInfo,
	StarList,
} from "./types.js";

const DEBUG = !!Bun.env.DEBUG;
const PAGE_SIZE: number = Math.max(
	10,
	Math.min(100, Number(Bun.env.LISTS_PAGE_SIZE ?? 25)),
);
const CONCURRENCY: number = Number(Bun.env.LISTS_CONCURRENCY ?? 3);

// ───────────────────────────────── logging ─────────────────────────────────
const t0 = Date.now();
function dlog(...args: unknown[]): void {
	if (!DEBUG) return;
	console.info(
		`[debug +${String(Date.now() - t0).padStart(4, " ")}ms]`,
		...args,
	);
}

// ──────────────────────────────── queries ──────────────────────────────────

// 1) Page viewer.lists to collect edge cursors (metadata)
const LISTS_EDGES_PAGE = gql`
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
const LIST_ITEMS_AT_EDGE = gql`
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

/** Fetch all items for a list identified by the cursor *before* it (edgeBefore). */
async function fetchAllItemsAtEdge(
	token: string,
	listEdgeCursorBefore: string | null,
	listNameForLogs: string,
): Promise<RepoInfo[]> {
	const repos: RepoInfo[] = [];
	let itemsAfter: string | null = null;
	let pageNo = 0;

	dlog(
		`items: start list="${listNameForLogs}" edgeBefore=${JSON.stringify(
			listEdgeCursorBefore,
		)} pageSize=${PAGE_SIZE}`,
	);

	type ListNode = ListItemsAtEdge["viewer"]["lists"]["nodes"][number];
	type ItemNode =
		ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number];

	// eslint-disable-next-line no-constant-condition
	while (true) {
		pageNo++;
		dlog(
			`items: query page #${pageNo} list="${listNameForLogs}" itemsAfter=${JSON.stringify(
				itemsAfter,
			)}`,
		);

		const data: ListItemsAtEdge = await githubGraphQL<ListItemsAtEdge>(
			token,
			LIST_ITEMS_AT_EDGE,
			{
				listAfter: listEdgeCursorBefore,
				itemsAfter,
				pageSize: PAGE_SIZE,
			},
		);

		const listNode: ListNode | undefined = data.viewer.lists.nodes[0];
		if (!listNode) {
			throw new Error(
				`List node not found at edge=${String(
					listEdgeCursorBefore,
				)} (hint: ${listNameForLogs})`,
			);
		}

		const items = listNode.items;
		const before = repos.length;

		for (const n of items.nodes as ItemNode[]) {
			if (!n || n.__typename !== "Repository") continue;

			const topics: string[] =
				n.repositoryTopics?.nodes
					?.map((x) => x.topic?.name)
					.filter((s): s is string => !!s) ?? [];

			repos.push({
				nameWithOwner: n.nameWithOwner ?? "",
				url: n.url ?? "",
				description: n.description ?? null,
				homepageUrl: n.homepageUrl ?? null,

				stars: n.stargazerCount ?? 0,
				forks: n.forkCount ?? 0,
				watchers: 0, // not selected here

				openIssues: n.issues?.totalCount ?? 0,
				openPRs: n.pullRequests?.totalCount ?? 0,

				defaultBranch: n.defaultBranchRef?.name ?? null,
				lastCommitISO:
					(n.defaultBranchRef?.target &&
						"committedDate" in n.defaultBranchRef.target &&
						(n.defaultBranchRef.target as { committedDate?: string })
							.committedDate) ??
					undefined,

				lastRelease: null, // not selected here
				topics,
				primaryLanguage: n.primaryLanguage?.name ?? null,
				languages: [], // not selected here

				license: n.licenseInfo?.spdxId ?? null,

				isArchived: !!n.isArchived,
				isDisabled: !!n.isDisabled,
				isFork: !!n.isFork,
				isMirror: !!n.isMirror,
				hasIssuesEnabled: !!n.hasIssuesEnabled,

				pushedAt: n.pushedAt ?? "",
				updatedAt: n.updatedAt ?? "",
				createdAt: n.createdAt ?? "",

				diskUsage: null, // not selected here
			});
		}

		dlog(
			`items: page #${pageNo} got=${repos.length - before} total=${
				repos.length
			} hasNext=${items.pageInfo.hasNextPage} endCursor=${JSON.stringify(
				items.pageInfo.endCursor,
			)}`,
		);

		if (!items.pageInfo.hasNextPage) break;
		itemsAfter = items.pageInfo.endCursor;
	}

	dlog(`items: done list="${listNameForLogs}" total=${repos.length}`);
	return repos;
}

/** small bounded parallel map */
async function pMap<T, R>(
	input: T[],
	concurrency: number,
	fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(input.length) as R[];
	let i = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, input.length) },
		async (_, w) => {
			dlog(`pMap: worker#${w} start`);
			for (;;) {
				const idx = i++;
				if (idx >= input.length) {
					dlog(`pMap: worker#${w} done`);
					return;
				}
				dlog(`pMap: worker#${w} running index=${idx}`);
				results[idx] = await fn(input[idx], idx);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

// ─────────────────────────────── public API ────────────────────────────────

/** Fetch all lists and all items (fully paginated). */
export async function getAllLists(token: string): Promise<StarList[]> {
	type Meta = {
		edgeBefore: string | null;
		name: string;
		description: string | null;
		isPrivate: boolean;
	};

	dlog("env:", {
		DEBUG: Bun.env.DEBUG,
		LISTS_CONCURRENCY: String(CONCURRENCY),
		LISTS_PAGE_SIZE: String(PAGE_SIZE),
	});

	const metas: Meta[] = [];
	let after: string | null = null;
	let previousEdgeCursor: string | null = null;
	let pageNo = 0;

	dlog("lists: begin paging metadata");

	// eslint-disable-next-line no-constant-condition
	while (true) {
		pageNo++;
		dlog(`lists: query page #${pageNo} after=${JSON.stringify(after)}`);

		const data: ListsEdgesPage = await githubGraphQL<ListsEdgesPage>(
			token,
			LISTS_EDGES_PAGE,
			{ after },
		);

		const page = data.viewer.lists;
		dlog(
			`lists: page #${pageNo} edges=${page.edges.length} hasNext=${
				page.pageInfo.hasNextPage
			} endCursor=${JSON.stringify(page.pageInfo.endCursor)}`,
		);

		for (const edge of page.edges) {
			metas.push({
				edgeBefore: previousEdgeCursor,
				name: edge.node.name,
				description: edge.node.description ?? null,
				isPrivate: edge.node.isPrivate,
			});
			dlog(
				`lists: push meta name="${edge.node.name}" edgeBefore=${JSON.stringify(
					previousEdgeCursor,
				)}`,
			);
			previousEdgeCursor = edge.cursor;
		}

		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor;
	}

	dlog(`lists: collected metas=${metas.length}, concurrency=${CONCURRENCY}`);
	const lists: StarList[] = await pMap(metas, CONCURRENCY, async (m, idx) => {
		dlog(
			`list#${idx}: fetch items "${m.name}" edgeBefore=${JSON.stringify(
				m.edgeBefore,
			)}`,
		);
		const repos: RepoInfo[] = await fetchAllItemsAtEdge(
			token,
			m.edgeBefore,
			m.name,
		);
		const out: StarList = {
			name: m.name,
			description: m.description,
			isPrivate: m.isPrivate,
			repos,
		};
		return out;
	});

	dlog(`lists: done, total lists=${lists.length}`);
	return lists;
}

/** Fetch repos for a specific list by name (case-insensitive), fully paginated. */
export async function getReposFromList(
	token: string,
	listName: string,
): Promise<RepoInfo[]> {
	const target: string = listName.toLowerCase();
	let after: string | null = null;
	let previousEdgeCursor: string | null = null;
	let pageNo = 0;

	dlog(`reposByName: search "${listName}"`);

	// eslint-disable-next-line no-constant-condition
	while (true) {
		pageNo++;
		dlog(
			`reposByName: query lists page #${pageNo} after=${JSON.stringify(after)}`,
		);

		const data: ListsEdgesPage = await githubGraphQL<ListsEdgesPage>(
			token,
			LISTS_EDGES_PAGE,
			{ after },
		);

		const { edges, pageInfo } = data.viewer.lists;

		for (const edge of edges) {
			dlog(
				`reposByName: inspect name="${
					edge.node.name
				}" prevEdge=${JSON.stringify(previousEdgeCursor)}`,
			);
			if (edge.node.name.toLowerCase() === target) {
				dlog(`reposByName: match "${edge.node.name}" → fetch items`);
				return fetchAllItemsAtEdge(token, previousEdgeCursor, edge.node.name);
			}
			previousEdgeCursor = edge.cursor;
		}

		if (!pageInfo.hasNextPage) break;
		after = pageInfo.endCursor;
	}

	throw new Error(`List not found: ${listName}`);
}
