import { describe, expect, mock, test } from "bun:test";
import type {
	Deps as ApiDeps,
	RepoMini,
	RepoRef,
	TopicMeta,
} from "@features/topics/types";
import {
	enrichAllRepoTopicsCore,
	type LoggerLike,
	resolveEnrichRuntime,
	type SpinnerController,
	type SpinnerHandle,
	type TopicsDeps,
} from "./topics";

function makeLogger() {
	const headers: string[] = [];
	const infos: string[] = [];
	const successes: string[] = [];
	const spinnerStarts: string[] = [];
	const succeedMsgs: string[] = [];

	const handle: SpinnerHandle = {
		text: "",
		succeed: (msg: string) => {
			succeedMsgs.push(msg);
		},
		stop: () => {},
	};

	const log: LoggerLike = {
		header: (m) => headers.push(m),
		info: (m) => infos.push(m),
		success: (m) => successes.push(m),
		line: (_?: string) => {},
		spinner: (txt: string): SpinnerController => {
			spinnerStarts.push(txt);
			return { start: () => handle };
		},
	};

	return { log, headers, infos, successes, spinnerStarts, succeedMsgs };
}

describe("resolveEnrichRuntime", () => {
	test("opts override env; env used when opts missing", () => {
		const prevTTL = Bun.env.TOPIC_TTL_DAYS;
		const prevC = Bun.env.TOPIC_REPO_CONCURRENCY;

		Bun.env.TOPIC_TTL_DAYS = "40";
		Bun.env.TOPIC_REPO_CONCURRENCY = "6";
		const r1 = resolveEnrichRuntime({ onlyActive: true });
		expect(r1.ONLY_ACTIVE).toBe(true);
		expect(r1.TTL_DAYS).toBe(40);
		expect(r1.CONCURRENCY_REPOS).toBe(6);

		const r2 = resolveEnrichRuntime({ onlyActive: false, ttlDays: 12 });
		expect(r2.ONLY_ACTIVE).toBe(false);
		expect(r2.TTL_DAYS).toBe(12);
		expect(r2.CONCURRENCY_REPOS).toBe(6);

		Bun.env.TOPIC_TTL_DAYS = prevTTL;
		Bun.env.TOPIC_REPO_CONCURRENCY = prevC;
	});
});

describe("enrichAllRepoTopicsCore", () => {
	test("early exit when no repos", async () => {
		const { log, infos } = makeLogger();

		const deps: TopicsDeps = {
			// service fns
			listRepoRefsFromDb: mock((onlyActive?: boolean) => {
				expect(onlyActive).toBe(false);
				return [];
			}),
			buildRepoRefs: mock((rows: RepoMini[]): RepoRef[] =>
				rows.map((r) => ({ ...r, name: "", owner: "" })),
			),
			reconcileRowsAndCollectUniverse: mock(
				(_rows, _tbr, _norm, _recon) => new Set<string>(),
			),
			refreshStaleTopicMeta: mock((_u, _ttl, _sel, _meta, _up, _al, _rel) => 0),
			// api fns (match ApiDeps)
			normalizeTopics: mock<ApiDeps["normalizeTopics"]>((t) => t),
			reconcileRepoTopics: mock<ApiDeps["reconcileRepoTopics"]>(
				(_rows, _tbr) => {},
			),
			repoTopicsMany: mock<ApiDeps["repoTopicsMany"]>(
				(_refs, _opts) => new Map(),
			),
			selectStaleTopics: mock<ApiDeps["selectStaleTopics"]>((_u, _ttl) => []),
			topicMetaMany: mock<ApiDeps["topicMetaMany"]>((topics) => {
				const out = new Map<string, TopicMeta | null>();
				for (const t of topics) out.set(t, null); // or a TopicMeta stub
				return out;
			}),
			upsertTopic: mock<ApiDeps["upsertTopic"]>((_x) => {}),
			upsertTopicAliases: mock<ApiDeps["upsertTopicAliases"]>((_x) => {}),
			upsertTopicRelated: mock<ApiDeps["upsertTopicRelated"]>((_x) => {}),
		};

		await enrichAllRepoTopicsCore(deps, log);
		expect(infos).toContain("No repositories found to enrich (check your DB).");
	});

	test("full flow with env + opts + logging", async () => {
		const { log, headers, infos, successes, spinnerStarts, succeedMsgs } =
			makeLogger();

		const rows: RepoMini[] = [
			{ id: 1, name_with_owner: "o/r1", is_archived: 0 },
			{ id: 2, name_with_owner: "o/r2", is_archived: 0 },
		];
		const _refs = { derived: true } as const;
		const _topicsByRepo = new Map<string, readonly string[]>([
			["o/r1", ["iot", "python"]],
			["o/r2", ["automation"]],
		]);
		let producedTopicsByRepo: Map<string, string[]>;

		const deps: TopicsDeps = {
			listRepoRefsFromDb: mock((onlyActive?: boolean) => {
				expect(onlyActive).toBe(true);
				return rows;
			}),
			buildRepoRefs: mock((rowsIn: RepoMini[]): RepoRef[] =>
				rowsIn.map(({ name_with_owner }) => {
					const [owner, name] = name_with_owner.split("/");
					return { owner, name };
				}),
			),
			reconcileRowsAndCollectUniverse: mock((inputRows, tbr, _norm, _recon) => {
				expect(inputRows).toBe(rows);
				expect(tbr).toBe(producedTopicsByRepo); // not a hand-made map
				return new Set<string>(["iot", "python", "automation"]);
			}),
			refreshStaleTopicMeta: mock(
				(universe, ttl, select, _meta, _up, _al, _rel) => {
					expect(ttl).toBe(15);
					const stale = select(universe, ttl);
					expect(stale.length).toBe(3);
					return 2;
				},
			),
			normalizeTopics: mock<ApiDeps["normalizeTopics"]>((t) => t),
			reconcileRepoTopics: mock<ApiDeps["reconcileRepoTopics"]>(
				(_rows, _tbr) => {},
			),
			repoTopicsMany: mock<ApiDeps["repoTopicsMany"]>((refs, opts) => {
				expect(opts?.concurrency).toBe(8);
				producedTopicsByRepo = new Map<string, string[]>();
				for (const r of refs) {
					const key = `${r.owner}/${r.name}`;
					producedTopicsByRepo.set(
						key,
						key === "o/r2" ? ["automation"] : ["iot", "python"],
					);
				}
				return producedTopicsByRepo;
			}),
			selectStaleTopics: mock<ApiDeps["selectStaleTopics"]>(
				(universeLike, _ttlDays) => {
					const topics =
						typeof universeLike === "string"
							? (JSON.parse(universeLike) as string[])
							: Array.from(universeLike as ReadonlySet<string>);
					return topics.map((topic) => ({ topic }));
				},
			),
			topicMetaMany: mock<ApiDeps["topicMetaMany"]>((topics) => {
				const out = new Map<string, TopicMeta | null>();
				for (const t of topics) out.set(t, null); // or a TopicMeta stub
				return out;
			}),
			upsertTopic: mock<ApiDeps["upsertTopic"]>((_x) => {}),
			upsertTopicAliases: mock<ApiDeps["upsertTopicAliases"]>((_x) => {}),
			upsertTopicRelated: mock<ApiDeps["upsertTopicRelated"]>((_x) => {}),
		};

		const prevC = Bun.env.TOPIC_REPO_CONCURRENCY;
		const prevTTL = Bun.env.TOPIC_TTL_DAYS;
		Bun.env.TOPIC_REPO_CONCURRENCY = "8";
		Bun.env.TOPIC_TTL_DAYS = "99"; // overridden by opts

		await enrichAllRepoTopicsCore(deps, log, { onlyActive: true, ttlDays: 15 });

		expect(headers).toContain("Topics enrichment");
		expect(infos.some((m) => m.includes("Repos: 2"))).toBe(true);

		expect(spinnerStarts[0]).toMatch(/Fetching topics/);
		expect(spinnerStarts[1]).toMatch(/Reconciling/);
		expect(spinnerStarts[2]).toMatch(/Refreshing topic metadata/);

		expect(succeedMsgs).toContain("Fetched topics for 2 repos");
		expect(
			succeedMsgs.some((m) => m.includes("Unique topics discovered: 3")),
		).toBe(true);
		expect(
			succeedMsgs.some((m) => m.includes("Refreshed metadata for 2 topics")),
		).toBe(true);

		expect(successes).toContain(
			"Topics enriched: repos=2  unique_topics=3  refreshed=2",
		);

		Bun.env.TOPIC_REPO_CONCURRENCY = prevC;
		Bun.env.TOPIC_TTL_DAYS = prevTTL;
	});
});
