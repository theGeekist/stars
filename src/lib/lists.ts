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

// NOTE: Undocumented field `viewer.lists`.
const LISTS_QUERY = gql`
  query ListsPage($after: String) {
    viewer {
      lists(first: 20, after: $after) {
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          name
          description
          isPrivate
          items(first: 100) {
            pageInfo {
              endCursor
              hasNextPage
            }
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
  }
`;

type ListsPage = {
  viewer: {
    lists: {
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      nodes: Array<{
        name: string;
        description?: string | null;
        isPrivate: boolean;
        items: {
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
          nodes: Array<{
            __typename: string;
            nameWithOwner?: string;
            url?: string;
            stargazerCount?: number;
          }>;
        };
      }>;
    };
  };
};

export async function getAllLists(token: string): Promise<StarList[]> {
  const out: StarList[] = [];
  let after: string | null = null;

  while (true) {
    const data: ListsPage = await githubGraphQL<ListsPage>(token, LISTS_QUERY, {
      after,
    });
    const page: ListsPage["viewer"]["lists"] = data.viewer.lists;
    for (const l of page.nodes) {
      const repos: RepoLite[] = l.items.nodes
        .filter((n) => n.__typename === "Repository")
        .map((n) => ({
          nameWithOwner: n.nameWithOwner!,
          url: n.url!,
          stars: n.stargazerCount ?? 0,
        }));

      // TODO: If l.items.pageInfo.hasNextPage, issue a per-list follow-up query to fetch remaining items.
      out.push({
        name: l.name,
        description: l.description ?? null,
        isPrivate: l.isPrivate,
        repos,
      });
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

export async function getReposFromList(
  token: string,
  listName: string
): Promise<RepoLite[]> {
  const lists = await getAllLists(token);
  const l = lists.find((x) => x.name.toLowerCase() === listName.toLowerCase());
  if (!l) throw new Error(`List not found: ${listName}`);
  return l.repos;
}
