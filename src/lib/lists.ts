// src/lib/lists.ts
import { githubGraphQL, gql } from "./github.js";
import type { ListItemsAtEdge, ListsEdgesPage, RepoInfo, StarList } from "./types.js";

const DEBUG = !!Bun.env.DEBUG;

// ---- tiny logging helpers (no-ops unless DEBUG) ---------------------------------
const t0 = Date.now();
function dlog(...args: unknown[]) {
  if (!DEBUG) return;
  const since = String(Date.now() - t0).padStart(5, " ");
  console.error(`[debug +${since}ms]`, ...args);
}
function redactToken(tok?: string | null) {
  if (!tok) return "(missing)";
  const s = String(tok);
  if (s.length <= 8) return "(short)";
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

// On first import, if DEBUG, print environment summary once.
(() => {
  if (!DEBUG) return;
  dlog("env:", {
    DEBUG: Bun.env.DEBUG ?? undefined,
    LISTS_CONCURRENCY: Bun.env.LISTS_CONCURRENCY ?? "(default 3)",
    GQL_TIMEOUT_MS: Bun.env.GQL_TIMEOUT_MS ?? "(default 30000)",
    GQL_MAX_RETRIES: Bun.env.GQL_MAX_RETRIES ?? "(default 6)",
    GQL_BASE_DELAY_MS: Bun.env.GQL_BASE_DELAY_MS ?? "(default 400)",
    GQL_USER_AGENT: Bun.env.GQL_USER_AGENT ?? "(default geek-stars/0.1)",
    GITHUB_TOKEN: redactToken(Bun.env.GITHUB_TOKEN),
  });
})();

// ---- queries --------------------------------------------------------------------

/** 1) Page through viewer.lists edges to capture each list’s “edge-before” cursor */
const LISTS_EDGES_PAGE = gql`
  query ListsEdgesPage($after: String) {
    viewer {
      lists(first: 20, after: $after) {
        pageInfo { endCursor hasNextPage }
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

/**
 * 2) Re-select exactly one list (first after edgeBefore) and page its items with a rich repo selection.
 * This avoids needing an internal List typename.
 */
const LIST_ITEMS_AT_EDGE = gql`
  query ListItemsAtEdge($listAfter: String, $itemsAfter: String) {
    viewer {
      lists(first: 1, after: $listAfter) {
        nodes {
          name
          items(first: 100, after: $itemsAfter) {
            pageInfo { endCursor hasNextPage }
            nodes {
              __typename
              ... on Repository {
                nameWithOwner
                url
                description
                homepageUrl

                stargazerCount
                forkCount
                watchers { totalCount }

                issues(states: OPEN) { totalCount }
                pullRequests(states: OPEN) { totalCount }

                defaultBranchRef {
                  name
                  target { ... on Commit { committedDate } }
                }

                releases(last: 1) { nodes { tagName publishedAt } }

                repositoryTopics(first: 50) { nodes { topic { name } } }
                primaryLanguage { name }
                languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
                  edges { size node { name } }
                }

                licenseInfo { spdxId }

                isArchived
                isDisabled
                isFork
                isMirror
                hasIssuesEnabled

                pushedAt
                updatedAt
                createdAt

                diskUsage
              }
            }
          }
        }
      }
    }
  }
`;

// ---- internals ------------------------------------------------------------------

async function fetchAllItemsAtEdge(
  token: string,
  listEdgeCursorBefore: string | null,
  listNameForLogs: string,
): Promise<RepoInfo[]> {
  const start = Date.now();
  const repos: RepoInfo[] = [];
  let itemsAfter: string | null = null;
  let pageNo = 0;

  dlog(`items: start list="${listNameForLogs}" edgeBefore=${JSON.stringify(listEdgeCursorBefore)}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pageNo++;
    dlog(`items: query page #${pageNo} list="${listNameForLogs}" itemsAfter=${JSON.stringify(itemsAfter)}`);

    const data: ListItemsAtEdge = await githubGraphQL<ListItemsAtEdge>(
      token,
      LIST_ITEMS_AT_EDGE,
      { listAfter: listEdgeCursorBefore, itemsAfter },
    );

    const node = data.viewer.lists.nodes[0];
    if (!node) {
      throw new Error(`List node not found at edge=${String(listEdgeCursorBefore)} (name hint: ${listNameForLogs})`);
    }

    const { items } = node;
    const beforePushCount = repos.length;

    for (const n of items.nodes) {
      if (n.__typename !== "Repository" || !n.nameWithOwner || !n.url) continue;

      repos.push({
        nameWithOwner: n.nameWithOwner,
        url: n.url,
        description: n.description ?? null,
        homepageUrl: n.homepageUrl ?? null,

        stars: n.stargazerCount ?? 0,
        forks: n.forkCount ?? 0,
        watchers: n.watchers?.totalCount ?? 0,

        openIssues: n.issues?.totalCount ?? 0,
        openPRs: n.pullRequests?.totalCount ?? 0,

        defaultBranch: n.defaultBranchRef?.name ?? null,
        lastCommitISO: (n.defaultBranchRef?.target as { committedDate?: string } | undefined)?.committedDate ?? null,

        lastRelease: n.releases?.nodes?.[0]
          ? { tagName: n.releases.nodes[0].tagName ?? null, publishedAt: n.releases.nodes[0].publishedAt ?? null }
          : null,

        topics: (n.repositoryTopics?.nodes ?? []).map((x) => x.topic.name),
        primaryLanguage: n.primaryLanguage?.name ?? null,
        languages: (n.languages?.edges ?? []).map((e) => ({ name: e.node.name, bytes: e.size })),

        license: n.licenseInfo?.spdxId ?? null,

        isArchived: !!(n as any).isArchived,
        isDisabled: !!(n as any).isDisabled,
        isFork: !!(n as any).isFork,
        isMirror: !!(n as any).isMirror,
        hasIssuesEnabled: !!(n as any).hasIssuesEnabled,

        pushedAt: (n as any).pushedAt ?? "",
        updatedAt: (n as any).updatedAt ?? "",
        createdAt: (n as any).createdAt ?? "",

        diskUsage: (n as any).diskUsage ?? null,
      });
    }

    dlog(
      `items: page #${pageNo} got=${repos.length - beforePushCount} total=${repos.length} hasNext=${
        items.pageInfo.hasNextPage
      } endCursor=${JSON.stringify(items.pageInfo.endCursor)}`,
    );

    if (!items.pageInfo.hasNextPage) break;
    itemsAfter = items.pageInfo.endCursor;
  }

  dlog(`items: done list="${listNameForLogs}" total=${repos.length} took=${Date.now() - start}ms`);
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
  const workers = Array.from({ length: Math.min(concurrency, input.length) }, async (_, widx) => {
    dlog(`pMap: worker#${widx} start`);
    for (;;) {
      const idx = i++;
      if (idx >= input.length) {
        dlog(`pMap: worker#${widx} done`);
        return;
      }
      dlog(`pMap: worker#${widx} running index=${idx}`);
      results[idx] = await fn(input[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- public API -----------------------------------------------------------------

/** Fetch all lists + all items (fully paginated) using edge cursors */
export async function getAllLists(token: string): Promise<StarList[]> {
  const start = Date.now();
  type Meta = { edgeBefore: string | null; name: string; description?: string | null; isPrivate: boolean };

  const metas: Meta[] = [];
  let after: string | null = null;
  let previousEdgeCursor: string | null = null;
  let pageNo = 0;

  dlog("lists: begin paging metadata");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pageNo++;
    dlog(`lists: query page #${pageNo} after=${JSON.stringify(after)}`);

    const data: ListsEdgesPage = await githubGraphQL<ListsEdgesPage>(token, LISTS_EDGES_PAGE, { after });
    const page = data.viewer.lists;

    dlog(
      `lists: page #${pageNo} edges=${page.edges.length} hasNext=${page.pageInfo.hasNextPage} endCursor=${JSON.stringify(
        page.pageInfo.endCursor,
      )}`,
    );

    for (const edge of page.edges) {
      metas.push({
        edgeBefore: previousEdgeCursor,
        name: edge.node.name,
        description: edge.node.description ?? null,
        isPrivate: edge.node.isPrivate,
      });
      dlog(`lists: push meta name="${edge.node.name}" edgeBefore=${JSON.stringify(previousEdgeCursor)}`);
      previousEdgeCursor = edge.cursor;
    }

    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  dlog(`lists: collected metas=${metas.length}, concurrency=${Number(Bun.env.LISTS_CONCURRENCY ?? 3)}`);

  const CONCURRENCY = Number(Bun.env.LISTS_CONCURRENCY ?? 3);
  const lists = await pMap(metas, CONCURRENCY, async (m, idx) => {
    dlog(`list#${idx}: fetching items for "${m.name}" edgeBefore=${JSON.stringify(m.edgeBefore)}`);
    const repos = await fetchAllItemsAtEdge(token, m.edgeBefore, m.name);
    return <StarList>{
      name: m.name,
      description: m.description ?? null,
      isPrivate: m.isPrivate,
      repos,
    };
  });

  dlog(`lists: done, total lists=${lists.length}, took=${Date.now() - start}ms`);
  return lists;
}

/** Fetch repos for a specific list by name (case-insensitive), fully paginated */
export async function getReposFromList(token: string, listName: string): Promise<RepoInfo[]> {
  const target = listName.toLowerCase();
  let after: string | null = null;
  let previousEdgeCursor: string | null = null;
  let pageNo = 0;

  dlog(`reposByName: begin search for "${listName}"`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pageNo++;
    dlog(`reposByName: query lists page #${pageNo} after=${JSON.stringify(after)}`);
    const data: ListsEdgesPage = await githubGraphQL<ListsEdgesPage>(token, LISTS_EDGES_PAGE, { after });
    const { edges, pageInfo } = data.viewer.lists;

    for (const edge of edges) {
      dlog(`reposByName: inspect name="${edge.node.name}" prevEdge=${JSON.stringify(previousEdgeCursor)}`);
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
