import { githubGraphQL, githubREST } from "@lib/github";
import { REPO_CORE_FRAGMENT } from "@lib/fragments";
import { mapStarEdgeToRepoInfo } from "@lib/mapper";
import type { StarEdge } from "@lib/types";
import type { CollectionSnapshot } from "./service";

type Source = { nameWithOwner: string; repoId: string; topics: string[] };
const splitName = (name: string) => {
	const parts = name.split("/");
	if (parts.length !== 2 || !parts.every((p) => /^[\w.-]+$/.test(p)))
		throw new Error(`Invalid repository name: ${name}`);
	return parts.map(encodeURIComponent).join("/");
};
export function githubDiscovery(token: string) {
	if (!token) throw new Error("GITHUB_TOKEN is required");
	const resolved = new Map<
		string,
		Promise<ReturnType<typeof mapStarEdgeToRepoInfo>>
	>();
	return {
		async load(source: Source): Promise<CollectionSnapshot> {
			const name = splitName(source.nameWithOwner);
			const [owner, repoName] = source.nameWithOwner.split("/");
			const identity = await githubGraphQL<{
				repository: { id: string } | null;
			}>(
				token,
				`query DiscoverySource($owner:String!,$name:String!) { repository(owner:$owner,name:$name) { id } }`,
				{ owner, name: repoName },
			);
			if (identity.repository?.id !== source.repoId)
				throw new Error(
					`Collection identity changed for ${source.nameWithOwner}`,
				);
			const head = await githubREST<{ sha: string }>(
				token,
				`/repos/${name}/commits/HEAD`,
			);
			const readme = await githubREST<{
				path: string;
				encoding: string;
				content: string;
			}>(token, `/repos/${name}/readme?ref=${encodeURIComponent(head.sha)}`);
			if (readme.encoding !== "base64")
				throw new Error("Unsupported README encoding");
			return {
				source: `github:${source.repoId}`,
				revision: head.sha,
				path: readme.path,
				markdown: Buffer.from(readme.content, "base64").toString("utf8"),
				baseUrl: `https://github.com/${name}/blob/${head.sha}/${readme.path}`,
				topics: source.topics,
			};
		},
		async resolve(url: string) {
			const target = new URL(url);
			if (target.hostname.toLowerCase() !== "github.com") return null;
			const parts = target.pathname.split("/").filter(Boolean);
			if (
				parts.length < 2 ||
				!parts[0] ||
				!parts[1] ||
				!/^[\w.-]+$/.test(parts[0]) ||
				!/^[\w.-]+$/.test(parts[1])
			)
				return null;
			if (parts.length > 2 && !["tree", "blob"].includes(parts[2])) return null;
			const owner = parts[0];
			const name = parts[1].replace(/\.git$/i, "");
			const cacheKey = `${owner}/${name}`.toLowerCase();
			let pending = resolved.get(cacheKey);
			if (!pending) {
				pending = (async () => {
					const result = await githubGraphQL<{
						repository: StarEdge["node"] | null;
					}>(
						token,
						`query DiscoveryRepo($owner:String!,$name:String!) { repository(owner:$owner,name:$name) { ...RepoCore } } ${REPO_CORE_FRAGMENT}`,
						{ owner, name },
					);
					if (!result.repository)
						throw new Error(`Repository not found: ${owner}/${name}`);
					return mapStarEdgeToRepoInfo({
						starredAt: "",
						node: result.repository,
					});
				})();
				resolved.set(cacheKey, pending);
			}
			try {
				return await pending;
			} catch (error) {
				resolved.delete(cacheKey);
				throw error;
			}
		},
	};
}
