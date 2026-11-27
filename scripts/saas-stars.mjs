#!/usr/bin/env node
// Run on the authenticated GitHub host. Dry-run by default; only adds stars and lists.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const account = args.find((x) => x.startsWith("--account="))?.split("=")[1];
const report =
	args.find((x) => x.startsWith("--report="))?.slice(9) ??
	"saas-stars-reconciliation.json";
const source = args.find((x) => x.startsWith("--manifest="))?.slice(11);
if (apply && !source)
	throw new Error("Apply requires --manifest=<reviewed manifest file>");
const group = {
	"business-commerce": `frappe/crm frappe/erpnext medusajs/medusa mercurjs/mercur vendurehq/vendure twentyhq/twenty getlago/lago openmeterio/openmeter polarsource/polar stripe/stripe-node useautumn/autumn wasp-lang/open-saas adamlauzon/SassyEL`,
	"content-publishing": `frappe/builder facebook/lexical GrapesJS/grapesjs payloadcms/payload puckeditor/puck ueberdosis/tiptap directus/directus keystonejs/keystone`,
	"automation-workflows": `activepieces/activepieces inngest/inngest n8n-io/n8n NangoHQ/nango PipedreamHQ/pipedream triggerdotdev/trigger.dev`,
	"ai-machine-learning": `a2ui-project/a2ui dyad-sh/dyad stackblitz-labs/bolt.diy totalumlabs/ai-app-builder-open vercel-labs/json-render modelcontextprotocol/modelcontextprotocol modelcontextprotocol/typescript-sdk cloudflare/vibesdk moutsea/agentflowing`,
	"productivity-utilities": `alchemy-run/alchemy AmanVarshney01/create-better-t-stack copier-org/copier hashicorp/terraform nrwl/nx opentofu/opentofu plopjs/plop sst/sst nextlevelbuilder/ui-ux-pro-max-skill pbakaus/impeccable nexu-io/open-design cloudflare/cf cloudflare/workers-sdk jdx/mise moonrepo/proto volta-cli/volta Schniz/fnm devcontainers/cli jetify-com/devbox cachix/devenv NixOS/nix projen/projen yeoman/yo moonrepo/moon vercel/turborepo go-task/task casey/just bazelbuild/bazel vitejs/vite evanw/esbuild rolldown/tsdown containers/podman docker/compose dagger/dagger moby/buildkit renovatebot/renovate dependabot/dependabot-core changesets/changesets googleapis/release-please`,
	"valuable-resources": `alibaba/formily apache/echarts baidu/amis better-auth/better-auth casbin/casbin cytoscape/cytoscape.js drizzle-team/drizzle-orm epicweb-dev/epic-stack epicweb-dev/epicflare farshidpourlatifi/edgeseed foson-co/arkite-ui frappe/frappe frappe/frappe-ui frappe/studio github/docs grafana/scenes honojs/hono Kanaries/graphic-walker keenthemes/reui leeoniya/uPlot marmelab/react-admin mimukit/saasaloy mockkey/flarekit mui/base-ui neo4j-contrib/neodash nocobase/nocobase OAI/OpenAPI-Specification objectstack-ai/objectstack objectstack-ai/objectui observablehq/plot perspective-dev/perspective redwoodjs/sdk refinedev/refine saas-js/saas-ui saasflare-dev/starter shadcn-ui/ui sourceplane/next-forge TanStack/form TanStack/query TanStack/router TanStack/table TanStack/virtual uwdata/mosaic vega/vega vega/vega-lite zenstackhq/zenstack googleapis/google-api-nodejs-client great-expectations/great_expectations OpenLineage/OpenLineage jacomyal/sigma.js open-metadata/OpenMetadata sodadata/soda-core oven-sh/bun nodejs/node microsoft/TypeScript hey-api/openapi-ts orval-labs/orval testcontainers/testcontainers-node cloudflare/workerd devcontainers/spec rocketflare-dev/rocketflare tremorlabs/tremor alepha-dev/alepha awecode/autoadmin MUKE-coder/flare-framework pocketbase/pocketbase SoftwareBrothers/adminjs wasp-lang/wasp websideproject/nuxt-auto apache/casbin-node-casbin better-auth-ui/better-auth-ui cerbos/query-plan-adapters cloudflare/workers-oauth-provider stalniy/casl`,
};
// Deliberately leave these unassigned instead of treating every platform as a utility.
const noFit = {
	"backstage/backstage": "Developer portals / platform engineering",
	"coollabsio/coolify": "Hosting / deployment platforms",
	"dokploy/dokploy": "Hosting / deployment platforms",
	"frappe/press": "Hosting / deployment platforms",
	"keycloak/keycloak": "Identity and access infrastructure",
	"logto-io/logto": "Identity and access infrastructure",
	"openfga/openfga": "Identity and access infrastructure",
	"ory/kratos": "Identity and access infrastructure",
	"cerbos/cerbos": "Identity and access infrastructure",
	"valuemelody/melody-auth": "Identity and access infrastructure",
	"pillar/z-cloudbase": "Operator / hosting infrastructure",
};
// Extra explicit report links and named A11/A12 leads. These identities are resolved
// by the live API before any changes. Leads are not necessarily inspected or pinned.
const reportExtras = `nextlevelbuilder/ui-ux-pro-max-skill pbakaus/impeccable nexu-io/open-design googleapis/google-api-nodejs-client cloudflare/cf cloudflare/workers-sdk great-expectations/great_expectations OpenLineage/OpenLineage jacomyal/sigma.js open-metadata/OpenMetadata sodadata/soda-core tremorlabs/tremor`;
const a12Extras = `jdx/mise moonrepo/proto volta-cli/volta Schniz/fnm oven-sh/bun nodejs/node devcontainers/cli devcontainers/spec jetify-com/devbox cachix/devenv NixOS/nix projen/projen yeoman/yo moonrepo/moon vercel/turborepo go-task/task casey/just bazelbuild/bazel vitejs/vite evanw/esbuild rolldown/tsdown microsoft/TypeScript hey-api/openapi-ts orval-labs/orval containers/podman docker/compose testcontainers/testcontainers-node cloudflare/workerd dagger/dagger moby/buildkit renovatebot/renovate dependabot/dependabot-core changesets/changesets googleapis/release-please`;
const unresolved = [
	"MetricUI (A11): canonical repository not established",
	"A12: generic ecosystem/tooling references (e.g. GitHub reusable workflows, Workers Builds, framework-specific CLIs) are not distinct repository candidates",
];
const split = (s) => s.trim().split(/\s+/).filter(Boolean);
const slug = (s) =>
	s
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
const map = new Map();
for (const [list, names] of Object.entries(group))
	for (const repo of split(names)) {
		const key = repo.toLowerCase();
		map.set(key, [...(map.get(key) ?? []), list]);
	}
function gh(argv, input) {
	const p = spawnSync("gh", argv, {
		input,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
	if (p.error || p.status !== 0)
		throw new Error(
			p.error?.message ?? p.stderr.trim() ?? `gh exit ${p.status}`,
		);
	return p.stdout;
}
function gql(query, variables = {}) {
	const result = JSON.parse(
		gh(
			["api", "graphql", "--input", "-"],
			JSON.stringify({ query, variables }),
		),
	);
	if (result.errors?.length)
		throw new Error(result.errors.map((e) => e.message).join("; "));
	return result.data;
}
function loadManifest() {
	if (source) return JSON.parse(readFileSync(source, "utf8"));
	const obj = JSON.parse(
		gh([
			"api",
			"repos/theGeekist/saas-research/contents/sources/manifest.json",
		]),
	);
	return JSON.parse(Buffer.from(obj.content, "base64").toString("utf8"));
}
const listQuery = `query($after:String){viewer{login lists(first:20,after:$after){pageInfo{endCursor hasNextPage} edges{cursor node{id name description}}}}}`;
const itemQuery = `query($listAfter:String,$after:String){viewer{lists(first:1,after:$listAfter){nodes{id name items(first:100,after:$after){pageInfo{endCursor hasNextPage} nodes{__typename ... on Repository{id nameWithOwner}}}}}}}`;
function listState() {
	let after = null,
		login,
		before = null;
	const lists = [],
		membership = new Map();
	do {
		const { viewer } = gql(listQuery, { after });
		login = viewer.login;
		for (const edge of viewer.lists.edges) {
			lists.push({ ...edge.node, before });
			before = edge.cursor;
		}
		after = viewer.lists.pageInfo.hasNextPage
			? viewer.lists.pageInfo.endCursor
			: null;
	} while (after);
	for (const list of lists) {
		let cursor = null;
		do {
			const n = gql(itemQuery, { listAfter: list.before, after: cursor }).viewer
				.lists.nodes[0];
			if (n?.id !== list.id)
				throw new Error(`List changed while reading: ${list.name}`);
			for (const item of n.items.nodes)
				if (item?.__typename === "Repository") {
					if (!membership.has(item.id)) membership.set(item.id, new Set());
					membership.get(item.id).add(list.id);
				}
			cursor = n.items.pageInfo.hasNextPage ? n.items.pageInfo.endCursor : null;
		} while (cursor);
	}
	return { login, lists, membership };
}
const repoQuery = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id nameWithOwner description viewerHasStarred isArchived isPrivate}}`;
const starMutation = `mutation($id:ID!){addStar(input:{starrableId:$id}){starrable{viewerHasStarred}}}`;
const listsMutation = `mutation($itemId:ID!,$listIds:[ID!]!){updateUserListsForItem(input:{itemId:$itemId,listIds:$listIds}){lists{id name}}}`;
const manifest = loadManifest();
if (!Array.isArray(manifest.repositories))
	throw new Error("Invalid source manifest");
const candidates = new Map();
for (const x of manifest.repositories) {
	if (typeof x?.id !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(x.id))
		throw new Error(`Invalid repository identity: ${JSON.stringify(x)}`);
	const key = x.id.toLowerCase();
	const previous = candidates.get(key);
	candidates.set(key, {
		repo: previous?.repo ?? x.id,
		packets: [...new Set([...(previous?.packets ?? []), ...(x.packets ?? [])])],
		optional: (previous?.optional ?? true) && !!x.optional,
		source: "manifest",
	});
}
// An explicit reviewed manifest is authoritative. Default preview alone shows extra leads.
if (!source)
	for (const [s, names] of [
		["report lead", reportExtras],
		["A12 initial lead", a12Extras],
	])
		for (const repo of split(names))
			if (!candidates.has(repo.toLowerCase()))
				candidates.set(repo.toLowerCase(), { repo, source: s, optional: true });
const state = listState();
function verifyAccount(snapshot) {
	if (
		(apply || account) &&
		(!account || account.toLowerCase() !== snapshot.login.toLowerCase())
	)
		throw new Error(`Apply requires --account=${snapshot.login}`);
}
verifyAccount(state);
function indexLists(snapshot) {
	const ids = new Map();
	for (const list of snapshot.lists) {
		const key = slug(list.name);
		if (ids.has(key)) throw new Error(`Duplicate list slug: ${key}`);
		ids.set(key, list.id);
	}
	return ids;
}
indexLists(state);
const results = [];
const seen = new Map();
// Resolve every alias and union classification before any mutation.
for (const [key, candidate] of candidates) {
	const row = { ...candidate };
	try {
		const [owner, name] = candidate.repo.split("/");
		const repo = gql(repoQuery, { owner, name }).repository;
		if (!repo?.id || !repo.nameWithOwner)
			throw new Error("Repository not found or not accessible");
		if (repo.isPrivate)
			throw new Error(
				"Unexpected private candidate; review identity before starring",
			);
		row.canonical = repo.nameWithOwner;
		row.repositoryId = repo.id;
		row.archived = repo.isArchived;
		row.description = repo.description;
		const canonicalKey = repo.nameWithOwner.toLowerCase();
		const desired = [
			...new Set([...(map.get(key) ?? []), ...(map.get(canonicalKey) ?? [])]),
		];
		const previous = seen.get(repo.id);
		if (previous) {
			row.duplicateOf = previous.canonical;
			previous.aliases.push(candidate.repo);
			previous.desiredLists = [
				...new Set([...previous.desiredLists, ...desired]),
			];
			previous.packets = [
				...new Set([...(previous.packets ?? []), ...(candidate.packets ?? [])]),
			];
			previous.optional = previous.optional && !!candidate.optional;
			if (!previous.reason)
				previous.reason = noFit[key] ?? noFit[canonicalKey] ?? null;
		} else {
			row.aliases = [candidate.repo];
			row.alreadyStarred = repo.viewerHasStarred;
			row.desiredLists = desired;
			row.reason = noFit[key] ?? noFit[canonicalKey] ?? null;
			seen.set(repo.id, row);
		}
	} catch (error) {
		row.error = String(error.message ?? error);
	}
	results.push(row);
}
// Refresh after identity resolution; replacement mutations still require exclusive list editing.
const executionState = apply ? listState() : state;
verifyAccount(executionState);
const listIds = indexLists(executionState);
const names = new Map(executionState.lists.map((l) => [l.id, l.name]));
for (const [id, row] of seen) {
	const existing = executionState.membership.get(id) ?? new Set();
	row.existingLists = [...existing].map(
		(listId) => names.get(listId) ?? listId,
	);
	row.missingTargetLists = row.desiredLists.filter((s) => !listIds.has(s));
	row.addLists = row.desiredLists.filter(
		(s) => listIds.has(s) && !existing.has(listIds.get(s)),
	);
	row.reason = row.desiredLists.length
		? null
		: (row.reason ??
			"No curated mapping; inspect repository description before assigning a list");
	try {
		if (apply) {
			// Re-read canonical identity and star state before writing.
			const [owner, name] = row.canonical.split("/");
			const current = gql(repoQuery, { owner, name }).repository;
			if (current?.id !== id || current.isPrivate)
				throw new Error("Repository identity or visibility changed");
			row.alreadyStarred = current.viewerHasStarred;
			if (!current.viewerHasStarred) {
				const out = gql(starMutation, { id });
				if (!out.addStar?.starrable?.viewerHasStarred)
					throw new Error("Star not confirmed");
				row.starAdded = true;
			}
			if (row.addLists.length) {
				const additions = row.addLists.map((s) => listIds.get(s));
				const next = [...new Set([...existing, ...additions])];
				const out = gql(listsMutation, { itemId: id, listIds: next });
				const confirmed = new Set(
					out.updateUserListsForItem?.lists?.map((l) => l.id),
				);
				row.listsAdded = additions
					.filter((listId) => confirmed.has(listId))
					.map((listId) => names.get(listId) ?? listId);
				if (!next.every((listId) => confirmed.has(listId)))
					throw new Error("List mutation not fully confirmed; inspect account");
				executionState.membership.set(id, confirmed);
			}
		}
	} catch (error) {
		row.error = String(error.message ?? error);
	}
}
for (const row of results) {
	console.log(
		`${row.error ? "ERROR" : row.duplicateOf ? "ALIAS" : row.starAdded ? "ADDED" : row.alreadyStarred ? "STARRED" : "UNSTARRED"} ${row.repo} ${row.addLists?.join(", ") ?? ""} ${row.reason ?? ""} ${row.error ?? ""}`,
	);
}
const canonical = [...seen.values()];
const summary = {
	mode: apply ? "apply" : "dry-run",
	account: executionState.login,
	manifestCount: manifest.repositories.length,
	candidateCount: candidates.size,
	canonicalCount: canonical.length,
	alreadyStarred: canonical.filter((r) => r.alreadyStarred).length,
	starsAdded: canonical.filter((r) => r.starAdded).length,
	newListMemberships: canonical.reduce(
		(n, r) => n + (r.listsAdded?.length ?? 0),
		0,
	),
	unclassified: canonical.filter((r) => r.reason).length,
	missingTargetLists: canonical.filter((r) => r.missingTargetLists?.length)
		.length,
	errors: results.filter((r) => r.error).length,
	unresolved,
};
writeFileSync(
	report,
	JSON.stringify(
		{
			summary,
			lists: executionState.lists.map(({ before, ...l }) => l),
			results,
		},
		null,
		2,
	) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
if (summary.errors) process.exitCode = 1;
