// src/lib/mapper.ts
import type { ListItemsAtEdge, RepoInfo, StarEdge } from "@lib/types";

/** Narrow the union for list item nodes to Repository. */
type ListItemNode =
	ListItemsAtEdge["viewer"]["lists"]["nodes"][number]["items"]["nodes"][number];

function isRepoNode(
	n: ListItemNode,
): n is Extract<ListItemNode, { __typename: "Repository" }> {
	return !!n && n.__typename === "Repository";
}

/** Optional: map GraphQL languages.edges -> RepoInfo.languages */
function mapLanguagesEdges(
	n:
		| { languages?: { edges: Array<{ size: number; node: { name: string } }> } }
		| undefined,
): RepoInfo["languages"] {
	const edges = n?.languages?.edges ?? [];
	if (!edges.length) return [];
	// Some APIs report `size`; we expose as bytes
	return edges.map((e) => ({ name: e.node.name, bytes: e.size ?? 0 }));
}

/** Extract topics[] safely */
function mapTopics(nodes?: Array<{ topic: { name: string } }>): string[] {
	return nodes?.map((x) => x.topic?.name).filter((s): s is string => !!s) ?? [];
}

/** Extract lastCommitISO safely */
function mapLastCommitISO(
	n:
		| {
				defaultBranchRef?: {
					target?: { committedDate?: string | null } | null;
				} | null;
		  }
		| undefined,
): string | undefined {
	const t = n?.defaultBranchRef?.target;
	// Guard because GraphQL returns a union on target
	return t &&
		typeof (t as { committedDate?: string }).committedDate === "string"
		? (t as { committedDate?: string }).committedDate
		: undefined;
}

/** Map a List-items Repository node → RepoInfo */
export function mapListRepoNodeToRepoInfo(n: ListItemNode): RepoInfo | null {
	if (!isRepoNode(n)) return null;
	if (!n.repoId) return null; // must have GH node id in new types

	const info: RepoInfo = {
		repoId: n.repoId, // required string
		nameWithOwner: n.nameWithOwner ?? "",
		url: n.url ?? "",
		description: n.description ?? null,
		homepageUrl: n.homepageUrl ?? null,

		stars: n.stargazerCount ?? 0,
		forks: n.forkCount ?? 0,
		watchers: n.watchers?.totalCount ?? 0,

		openIssues: n.issues?.totalCount ?? 0,
		openPRs: n.pullRequests?.totalCount ?? 0,

		defaultBranch: n.defaultBranchRef?.name ?? null,
		lastCommitISO: mapLastCommitISO(n),

		// We’re not selecting releases in your fragment yet; safe default:
		lastRelease: null,

		topics: mapTopics(n.repositoryTopics?.nodes),
		primaryLanguage: n.primaryLanguage?.name ?? null,
		languages: mapLanguagesEdges(n),

		license: n.licenseInfo?.spdxId ?? null,

		isArchived: !!n.isArchived,
		isDisabled: !!n.isDisabled,
		isFork: !!n.isFork,
		isMirror: !!n.isMirror,
		hasIssuesEnabled: !!n.hasIssuesEnabled,

		pushedAt: n.pushedAt ?? "",
		updatedAt: n.updatedAt ?? "",
		createdAt: n.createdAt ?? "",
		diskUsage: n.diskUsage ?? null,
	};

	return info;
}

/** Map a viewer.stars edge → RepoInfo */
export function mapStarEdgeToRepoInfo(edge: StarEdge): RepoInfo {
	const n = edge.node;

	const info: RepoInfo = {
		repoId: n.id, // required
		nameWithOwner: n.nameWithOwner ?? "",
		url: n.url ?? "",
		description: n.description ?? null,
		homepageUrl: n.homepageUrl ?? null,

		stars: n.stargazerCount ?? 0,
		forks: n.forkCount ?? 0,
		watchers: 0, // not requested in stars fragment

		openIssues: n.issues?.totalCount ?? 0,
		openPRs: n.pullRequests?.totalCount ?? 0,

		defaultBranch: n.defaultBranchRef?.name ?? null,
		lastCommitISO: mapLastCommitISO(n),

		lastRelease: null, // not requested in stars fragment
		topics:
			n.repositoryTopics?.nodes
				?.map((x) => x?.topic?.name)
				?.filter((s): s is string => !!s) ?? [],
		primaryLanguage: n.primaryLanguage?.name ?? null,
		languages: [], // not requested in stars fragment

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
	};

	return info;
}
