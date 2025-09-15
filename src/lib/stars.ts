// src/lib/stars.ts

import {
	debugEnv as debugEnvCommon,
	NoopReporter,
	type Reporter,
	resolvePagingConfig,
} from "./common.js";
import { githubGraphQL, gql } from "./github.js";
import type { RepoInfo, StarEdge } from "./types.js";

/* Public reporter for parity with lists */
export type StarsReporter = Reporter;

/* Local config resolver (namespaced env vars) */
function resolveStarsConfig(env: Record<string, string | undefined> = Bun.env) {
	// Use STARS_* envs; falls back to sane defaults if absent.
	const cfg = resolvePagingConfig(env, {
		pageSizeVar: "STARS_PAGE_SIZE",
		concurrencyVar: "STARS_CONCURRENCY",
		defaultPageSize: 25,
		minPageSize: 10,
		maxPageSize: 100,
	});
	return cfg;
}

function debugEnv(
	cfg: ReturnType<typeof resolveStarsConfig>,
	reporter: StarsReporter = NoopReporter,
) {
	// Pretty-print with a stars-prefixed label
	debugEnvCommon("stars", cfg, reporter);
}

/* ───────────────────────── GraphQL ───────────────────────── */

export const VIEWER_STARS_PAGE = gql`
  query ViewerStarsPage($after: String, $pageSize: Int = 100) {
    viewer {
      starredRepositories(first: $pageSize, after: $after, orderBy: {field: STARRED_AT, direction: DESC}) {
        pageInfo { endCursor hasNextPage }
        edges {
          starredAt
          node {
            id
            nameWithOwner
            url
            description
            homepageUrl
            stargazerCount
            forkCount
            issues(states: OPEN) { totalCount }
            pullRequests(states: OPEN) { totalCount }
            defaultBranchRef {
              name
              target { ... on Commit { committedDate } }
            }
            primaryLanguage { name }
            licenseInfo { spdxId }
            isArchived
            isDisabled
            isFork
            isMirror
            hasIssuesEnabled
            pushedAt
            updatedAt
            createdAt
            repositoryTopics(first: 50) {
              nodes { topic { name } }
            }
          }
        }
      }
    }
  }
`;

/* ──────────────────────── mapping ────────────────────────── */

function mapStarEdgeToRepoInfo(edge: StarEdge): RepoInfo {
	const n = edge.node;

	const topics: string[] =
		n.repositoryTopics?.nodes
			?.map((x) => x?.topic?.name)
			?.filter((s): s is string => !!s) ?? [];

	const lastCommitISO =
		n.defaultBranchRef?.target &&
		"committedDate" in (n.defaultBranchRef.target as object)
			? (n.defaultBranchRef.target as { committedDate?: string }).committedDate
			: undefined;

	return {
		// Keep parity with lists.ts RepoInfo
		repoId: n.id ?? null,
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
		lastCommitISO,

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

/* ─────────────────────── internals ───────────────────────── */

async function fetchStarsPage(
	token: string,
	after: string | null,
	pageSize: number,
	gh: typeof githubGraphQL,
	reporter: StarsReporter = NoopReporter,
) {
	const { debug } = reporter;
	debug?.(`stars: query page after=${JSON.stringify(after)} size=${pageSize}`);

	type Resp = {
		viewer: {
			starredRepositories: {
				pageInfo: { endCursor: string | null; hasNextPage: boolean };
				edges: StarEdge[];
			};
		};
	};

	const data = await gh<Resp>(token, VIEWER_STARS_PAGE, { after, pageSize });
	const page = data.viewer.starredRepositories;
	debug?.(
		`stars: edges=${page.edges.length} hasNext=${page.pageInfo.hasNextPage} endCursor=${JSON.stringify(
			page.pageInfo.endCursor,
		)}`,
	);
	return page;
}

/* ─────────────────────── public API ──────────────────────── */

/** Fetch **all** starred repositories as RepoInfo[] */
export async function getAllStars(
	token: string,
	gh: typeof githubGraphQL = githubGraphQL,
	reporter: StarsReporter = NoopReporter,
	signal?: AbortSignal,
): Promise<RepoInfo[]> {
	const cfg = resolveStarsConfig();
	debugEnv(cfg, reporter);

	const repos: RepoInfo[] = [];
	let after: string | null = null;
	let pageNo = 0;

	// eslint-disable-next-line no-constant-condition
	for (;;) {
		if (signal?.aborted) throw new Error("Aborted");
		pageNo++;
		const page = await fetchStarsPage(token, after, cfg.pageSize, gh, reporter);
		const before = repos.length;

		for (const e of page.edges) {
			repos.push(mapStarEdgeToRepoInfo(e));
		}

		reporter.debug?.(
			`stars: page #${pageNo} got=${repos.length - before} total=${repos.length}`,
		);

		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor;
	}
	reporter.debug?.(`stars: done total=${repos.length}`);
	return repos;
}

/**
 * Stream starred repositories in **pages** (arrays), useful for piping to a scorer.
 * Yields RepoInfo[] per page to avoid ballooning memory on very large accounts.
 */
export async function* getAllStarsStream(
	token: string,
	gh: typeof githubGraphQL = githubGraphQL,
	reporter: StarsReporter = NoopReporter,
	signal?: AbortSignal,
): AsyncGenerator<RepoInfo[], void, void> {
	const cfg = resolveStarsConfig();
	debugEnv(cfg, reporter);

	let after: string | null = null;
	let pageNo = 0;

	for (;;) {
		if (signal?.aborted) throw new Error("Aborted");
		pageNo++;
		const page = await fetchStarsPage(token, after, cfg.pageSize, gh, reporter);
		const batch = page.edges.map(mapStarEdgeToRepoInfo);
		reporter.debug?.(`stars: stream page #${pageNo} batch=${batch.length}`);
		yield batch;

		if (!page.pageInfo.hasNextPage) break;
		after = page.pageInfo.endCursor;
	}
}

/** Convenience: just the Set of repo IDs (useful for set-diff vs lists) */
export async function collectStarIdsSet(
	token: string,
	gh: typeof githubGraphQL = githubGraphQL,
	reporter: StarsReporter = NoopReporter,
	signal?: AbortSignal,
): Promise<Set<string>> {
	const ids = new Set<string>();
	for await (const batch of getAllStarsStream(token, gh, reporter, signal)) {
		for (const r of batch) if (r.repoId) ids.add(r.repoId);
	}
	return ids;
}

/* Re-export map for parity/testing if you snapshot raw GraphQL responses */
export const __testing = { mapStarEdgeToRepoInfo };

// Keep predictable, frozen defaults for deterministic tests
const DEFAULT_EDGE: Readonly<StarEdge> = {
	starredAt: "2024-01-01T00:00:00Z",
	node: {
		id: "R_id",
		nameWithOwner: "o/r",
		url: "https://x",
		description: "d",
		homepageUrl: null,
		stargazerCount: 10,
		forkCount: 2,
		issues: { totalCount: 3 },
		pullRequests: { totalCount: 4 },
		defaultBranchRef: {
			name: "main",
			target: { committedDate: "2024-01-02T00:00:00Z" },
		},
		primaryLanguage: { name: "TS" },
		licenseInfo: { spdxId: "MIT" },
		isArchived: false,
		isDisabled: false,
		isFork: false,
		isMirror: false,
		hasIssuesEnabled: true,
		pushedAt: "2024-01-03T00:00:00Z",
		updatedAt: "2024-01-04T00:00:00Z",
		createdAt: "2023-01-01T00:00:00Z",
		repositoryTopics: {
			nodes: [{ topic: { name: "x" } }, { topic: { name: "y" } }],
		},
	},
};

export function makeEdge(
	partial: Partial<StarEdge> & { node: Partial<StarEdge["node"]> },
): StarEdge {
	const n = partial.node ?? {};
	return {
		starredAt: partial.starredAt ?? DEFAULT_EDGE.starredAt,
		node: {
			...DEFAULT_EDGE.node,
			...n,
			// deep-merge nested objects that matter
			issues: n.issues ?? DEFAULT_EDGE.node.issues,
			pullRequests: n.pullRequests ?? DEFAULT_EDGE.node.pullRequests,
			defaultBranchRef:
				n.defaultBranchRef ?? DEFAULT_EDGE.node.defaultBranchRef,
			primaryLanguage: n.primaryLanguage ?? DEFAULT_EDGE.node.primaryLanguage,
			licenseInfo: n.licenseInfo ?? DEFAULT_EDGE.node.licenseInfo,
			repositoryTopics:
				n.repositoryTopics ?? DEFAULT_EDGE.node.repositoryTopics,
		},
	};
}

export function starsPage(
	edges: StarEdge[],
	hasNextPage: boolean,
	endCursor: string | null,
) {
	return {
		viewer: {
			starredRepositories: {
				pageInfo: { hasNextPage, endCursor },
				edges,
			},
		},
	};
}
