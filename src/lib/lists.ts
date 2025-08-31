// src/lib/lists.ts
import { githubGraphQL, gql } from "./github.js";

export type RepoLite = {
  nameWithOwner: string;
  url: string;
  stars: number;
};

export type StarList = {
  name: string;
  description?: string | null;
  isPrivate: boolean;
  repos: RepoLite[];
};

/** Page through the viewer's lists (metadata only). We'll fetch items per-list separately. */
const LISTS_PAGE = gql`
  query ListsPage($after: String) {
    viewer {
      lists(first: 20, after: $after) {
        pageInfo { endCursor hasNextPage }
        nodes {
          id
          __typename
          name
          description
          isPrivate
        }
      }
    }
  }
`;

type ListsPage = {
  viewer: {
    lists: {
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      nodes: Array<{
        id: string;
        __typename: string;
        name: string;
        description?: string | null;
        isPrivate: boolean;
      }>;
    };
  };
};

/** Page through items for a single list by ID (100 per page). */
const LIST_ITEMS_PAGE = gql`
  query ListItemsPage($id: ID!, $after: String) {
    node(id: $id) {
      __typename
      ... on List {
        items(first: 100, after: $after) {
          pageInfo { endCursor hasNextPage }
          nodes {
            __typename
            ... on Repository {
              nameWithOwner
              url
              stargazerCount
            }
          }
        }
      }
    }
  }
`;

type ListItemsPage = {
  node: null | {
    __typename: string;
    items?: {
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      nodes: Array<{
        __typename: string;
        nameWithOwner?: string;
        url?: string;
        stargazerCount?: number;
      }>;
    };
  };
};

/** Fetch ALL items for a given list id. */
async function fetchAllItemsForList(token: string, listId: string): Promise<RepoLite[]> {
  const repos: RepoLite[] = [];
  let after: string | null = null;

  // paginate items
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data: ListItemsPage = await githubGraphQL<ListItemsPage>(token, LIST_ITEMS_PAGE, { id: listId, after });
    const node = data.node;
    if (!node) throw new Error(`List node not found for id=${listId}`);
    if (node.__typename !== "List") throw new Error(`Unexpected node typename: ${node.__typename}`);

    const items = node.items;
    if (!items) break;

    for (const n of items.nodes) {
      if (n.__typename === "Repository") {
        repos.push({
          nameWithOwner: n.nameWithOwner!,
          url: n.url!,
          stars: n.stargazerCount ?? 0,
        });
      }
    }

    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }

  return repos;
}

/** Simple bounded parallelism for per-list item fetches. */
async function pMap<T, R>(
  input: T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(input.length) as R[];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, input.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= input.length) return;
      results[idx] = await fn(input[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Public: fetch all lists + all items for each list (fully paginated). */
export async function getAllLists(token: string): Promise<StarList[]> {
  type Meta = { id: string; name: string; description?: string | null; isPrivate: boolean };
  const metas: Meta[] = [];

  // paginate lists
  let after: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data: ListsPage = await githubGraphQL<ListsPage>(token, LISTS_PAGE, { after });
    const page = data.viewer.lists;

    for (const n of page.nodes) {
      metas.push({
        id: n.id,
        name: n.name,
        description: n.description ?? null,
        isPrivate: n.isPrivate,
      });
    }

    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  // fetch items per list (bounded concurrency to be polite on rate limits)
  const CONCURRENCY = 3;
  const lists = await pMap(metas, CONCURRENCY, async (m) => {
    const repos = await fetchAllItemsForList(token, m.id);
    return <StarList>{
      name: m.name,
      description: m.description ?? null,
      isPrivate: m.isPrivate,
      repos,
    };
  });

  return lists;
}

/** Public: fetch repos for a specific list by name (case-insensitive), paginated. */
export async function getReposFromList(token: string, listName: string): Promise<RepoLite[]> {
  const target = listName.toLowerCase();
  let after: string | null = null;

  // find the list id by paging metadata
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data: ListsPage = await githubGraphQL<ListsPage>(token, LISTS_PAGE, { after });
    const { nodes, pageInfo } = data.viewer.lists;
    const found = nodes.find((n) => n.name.toLowerCase() === target);
    if (found) {
      return fetchAllItemsForList(token, found.id);
    }
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  throw new Error(`List not found: ${listName}`);
}
