export type RepoInfo = {
  nameWithOwner: string;
  url: string;
  description?: string | null;
  homepageUrl?: string | null;

  stars: number;
  forks: number;
  watchers: number;

  openIssues: number;
  openPRs: number;

  defaultBranch?: string | null;
  lastCommitISO?: string | boolean;

  lastRelease?: { tagName?: string | null; publishedAt?: string | null } | null;

  topics: string[];
  primaryLanguage?: string | null;
  languages: { name: string; bytes: number }[];

  license?: string | null;

  isArchived: boolean;
  isDisabled: boolean;
  isFork: boolean;
  isMirror: boolean;
  hasIssuesEnabled: boolean;

  pushedAt: string;
  updatedAt: string;
  createdAt: string;

  diskUsage?: number | null;
};

export type StarList = {
  name: string;
  description?: string | null;
  isPrivate: boolean;
  repos: RepoInfo[];
};
export type ListsEdgesPage = {
  viewer: {
    lists: {
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      edges: Array<{
        cursor: string;
        node: { name: string; description?: string | null; isPrivate: boolean };
      }>;
    };
  };
};
export type ListItemsAtEdge = {
  viewer: {
    lists: {
      nodes: Array<{
        name: string;
        items: {
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
          nodes: Array<{
            __typename: string;
            nameWithOwner?: string;
            url?: string;
            description?: string | null;
            homepageUrl?: string | null;

            stargazerCount?: number;
            forkCount?: number;
            watchers?: { totalCount: number };

            issues?: { totalCount: number };
            pullRequests?: { totalCount: number };

            defaultBranchRef?: {
              name?: string | null;
              target?: { committedDate?: string | null } | null;
            } | null;

            releases?: {
              nodes: Array<{
                tagName?: string | null;
                publishedAt?: string | null;
              }>;
            };

            repositoryTopics?: { nodes: Array<{ topic: { name: string } }> };
            primaryLanguage?: { name: string } | null;
            languages?: {
              edges: Array<{ size: number; node: { name: string } }>;
            };

            licenseInfo?: { spdxId?: string | null } | null;

            isArchived?: boolean;
            isDisabled?: boolean;
            isFork?: boolean;
            isMirror?: boolean;
            hasIssuesEnabled?: boolean;

            pushedAt?: string;
            updatedAt?: string;
            createdAt?: string;

            diskUsage?: number | null;
          }>;
        };
      }>;
    };
  };
};export type ChunkingOptions = {
  chunkSizeTokens?: number;
  chunkOverlapTokens?: number;
  mode?: "sentence" | "token";
};
// --- typed statements --------------------------------------------------------
export type ReadmeRow = { id: number; readme_md: string | null; readme_etag: string | null; };

