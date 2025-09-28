// src/lib/mapper.ts
import type {
	ListItemsAtEdge,
	RepoInfo,
	RepoUpdatesMetadata,
	StarEdge,
	UpdateCandidate,
	UpdateSourceType,
} from "@lib/types";

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
	n?: {
		languages?: {
			edges?: Array<{ size?: number | null; node?: { name?: string } | null }>;
		} | null;
	} | null,
): RepoInfo["languages"] {
	const edges = n?.languages?.edges ?? [];
	if (!edges.length) return [];
	// Some APIs report `size`; we expose as bytes
	return edges
		.map((e) => ({ name: e.node?.name ?? "", bytes: e.size ?? 0 }))
		.filter((lang) => lang.name.length > 0);
}

/** Extract topics[] safely */
function mapTopics(
	nodes?: Array<{ topic?: { name?: string | null } | null } | null>,
): string[] {
	return (
		nodes?.map((x) => x?.topic?.name).filter((s): s is string => !!s) ?? []
	);
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

type RepoNodeWithUpdates =
	| Extract<ListItemNode, { __typename: "Repository" }>
	| StarEdge["node"];

const CHANGELOG_SOURCES: Array<{
	key: keyof RepoNodeWithUpdates;
	path: string;
}> = [
	{ key: "changelogRoot", path: "CHANGELOG.md" },
	{ key: "changelogDocs", path: "docs/CHANGELOG.md" },
	{ key: "changelogHistory", path: "HISTORY.md" },
	{ key: "changelogChanges", path: "CHANGES.md" },
	{ key: "changelogNews", path: "NEWS.md" },
];

function selectReleaseInfo(n: RepoNodeWithUpdates): RepoInfo["lastRelease"] {
	const release = n.releases?.nodes?.[0];
	if (!release) return null;
	return {
		tagName: release.tagName ?? null,
		publishedAt: release.publishedAt ?? null,
		url: release.url ?? null,
	};
}

function gatherChangelogCandidates(
	n: RepoNodeWithUpdates,
): Array<{ path: string; oid?: string | null; byteSize?: number | null }> {
	const entries: Array<{
		path: string;
		oid?: string | null;
		byteSize?: number | null;
	}> = [];
	for (const { key, path } of CHANGELOG_SOURCES) {
		const blob = (n as Record<string, unknown>)[key] as
			| { __typename?: string; oid?: string | null; byteSize?: number | null }
			| null
			| undefined;
		if (blob && (blob.byteSize != null || blob.oid != null)) {
			entries.push({
				path,
				oid: blob.oid ?? null,
				byteSize: blob.byteSize ?? null,
			});
		}
	}
	return entries;
}

function extractDiscussionCandidate(n: RepoNodeWithUpdates): {
	candidate: { id: string; name: string; slug?: string | null };
	confidence: number;
} | null {
	if (!n.hasDiscussionsEnabled) return null;
	const nodes = n.discussionCategories?.nodes ?? [];
	if (!nodes.length) return null;
	const pattern = /(announce|release|updates?|news)/i;
	let best = nodes.find(
		(c) => pattern.test(c.name) || (!!c.slug && pattern.test(c.slug)),
	);
	let confidence = 0.6;
	if (!best) {
		best = nodes[0];
	}
	if (
		best &&
		(pattern.test(best.name) || (!!best.slug && pattern.test(best.slug ?? "")))
	) {
		confidence = 0.7;
	}
	if (!best) return null;
	return {
		candidate: { id: best.id, name: best.name, slug: best.slug ?? null },
		confidence,
	};
}

function extractCommitSamples(
	n: RepoNodeWithUpdates,
): Array<{ committedDate?: string | null; messageHeadline?: string | null }> {
	const target = n.defaultBranchRef?.target as
		| {
				history?: {
					nodes?: Array<{
						committedDate?: string | null;
						messageHeadline?: string | null;
					}>;
				};
		  }
		| undefined;
	const nodes = target?.history?.nodes ?? [];
	return nodes
		.filter(
			(
				c,
			): c is {
				committedDate?: string | null;
				messageHeadline?: string | null;
			} => !!c,
		)
		.slice(0, 5);
}

const CONVENTIONAL_COMMIT_PATTERN =
	/^(build|ci|chore|docs|feat|fix|perf|refactor|revert|style|test)(\(.+\))?!?:/i;

function isConventionalCommit(message?: string | null): boolean {
	if (!message) return false;
	return CONVENTIONAL_COMMIT_PATTERN.test(message.trim());
}

function buildUpdatesMetadata(
	n: RepoNodeWithUpdates,
	releaseInfo: RepoInfo["lastRelease"],
): RepoUpdatesMetadata | null {
	const candidates: UpdateCandidate[] = [];

	if (releaseInfo) {
		candidates.push({
			type: "release",
			confidence: 0.95,
			data: releaseInfo,
		});
	}

	const changelogEntries = gatherChangelogCandidates(n);
	if (changelogEntries.length) {
		candidates.push({
			type: "changelog",
			confidence: 0.78,
			data: {
				primaryPath: changelogEntries[0]?.path,
				entries: changelogEntries,
			},
		});
	}

	const discussionCandidate = extractDiscussionCandidate(n);
	if (discussionCandidate) {
		candidates.push({
			type: "discussion",
			confidence: discussionCandidate.confidence,
			data: discussionCandidate.candidate,
		});
	}

	const commitSamples = extractCommitSamples(n);
	if (commitSamples.length) {
		const hasConventional = commitSamples.some((c) =>
			isConventionalCommit(c.messageHeadline ?? null),
		);
		candidates.push({
			type: "commit",
			confidence: hasConventional ? 0.45 : 0.32,
			data: { samples: commitSamples },
		});
	}

	if (!candidates.length) return null;
	let best: UpdateCandidate = candidates[0];
	for (const cand of candidates) {
		if (cand.confidence > best.confidence) best = cand;
	}
	return {
		preferred: (best.type as UpdateSourceType) ?? null,
		candidates,
	};
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

		topics: mapTopics(n.repositoryTopics?.nodes),
		primaryLanguage: n.primaryLanguage?.name ?? null,
		languages: mapLanguagesEdges({ languages: n.languages }),

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

	const releaseInfo = selectReleaseInfo(n);
	info.lastRelease = releaseInfo;
	const updates = buildUpdatesMetadata(n, releaseInfo);
	if (updates) info.updates = updates;

	return info;
}

/** Map a viewer.stars edge → RepoInfo */
export function mapStarEdgeToRepoInfo(edge: StarEdge): RepoInfo {
	const n = edge.node;

	const info: RepoInfo = {
		repoId: n.id,
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

		topics: mapTopics(n.repositoryTopics?.nodes),
		primaryLanguage: n.primaryLanguage?.name ?? null,
		languages: mapLanguagesEdges({ languages: n.languages }),

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

	const releaseInfo = selectReleaseInfo(n);
	info.lastRelease = releaseInfo;
	const updates = buildUpdatesMetadata(n, releaseInfo);
	if (updates) info.updates = updates;

	return info;
}
