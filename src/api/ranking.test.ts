import type { Database } from "bun:sqlite";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { createDb, initSchema } from "@lib/db";
import type { RepoRow } from "@lib/types";
import type { RankingItemResult } from "./public.types";

const baseRepo = (id: number, name: string): RepoRow => ({
	id,
	repo_id: `R_${id}`,
	name_with_owner: name,
	url: `https://github.com/${name}`,
	description: "Test repo",
	primary_language: "TypeScript",
	topics: '["testing"]',
	summary: "Summary",
	stars: 10,
	forks: 1,
	popularity: 0.5,
	freshness: 0.6,
	activeness: 0.7,
	is_archived: 0,
	is_disabled: 0,
});

let repos: RepoRow[] = [baseRepo(1, "org/one"), baseRepo(2, "org/two")];
let planResult: RankingItemResult["plannedLists"] extends string[]
	? {
			finalPlanned: string[];
			changed: boolean;
			blocked: boolean;
			blockReason?: string | null;
			fallbackUsed?: { list: string; score: number } | null;
		}
	: never = {
	finalPlanned: ["alpha"],
	changed: true,
	blocked: false,
	blockReason: null,
	fallbackUsed: null,
};
let currentMembership = new Map<number, string[]>([
	[1, ["alpha"]],
	[2, []],
]);
let persistCalls: Array<{ runId: number; repoId: number; scores: unknown }>;
let updateCalls: Array<{ repoGlobalId: string; targetListIds: string[] }>;
let scoreCallArgs: Array<{ lists: unknown; repo: unknown; llm: unknown }>;
let includeApplyError = false;
let llmToReturn: unknown = { generatePromptAndSend: async () => ({}) };

const buildBatchStats = (
	items: Array<{ status: "ok" | "error" | string; saved: boolean }>,
) => ({
	processed: items.length,
	succeeded: items.filter((i) => i.status === "ok").length,
	failed: items.filter((i) => i.status === "error").length,
	saved: items.filter((i) => i.saved).length,
});

const resolveGithubToken = ({ required = true }: { required?: boolean }) => {
	const token = Bun.env.GITHUB_TOKEN ?? "";
	if (!token && required) {
		throw new Error("GITHUB_TOKEN missing. Required to apply ranking changes.");
	}
	return token;
};

const resolveModelConfig = (cfg?: {
	model?: string;
	host?: string;
	apiKey?: string;
}) => {
	const model = cfg?.model ?? Bun.env.OLLAMA_MODEL ?? "";
	if (!model.trim()) throw new Error("Model missing");
	return { model: model.trim(), host: cfg?.host, apiKey: cfg?.apiKey };
};

const scoringService = {
	resolveRunContext: mock((opts: { dry: boolean }) => ({
		runId: opts.dry ? null : 99,
		filterRunId: null,
	})),
	selectRepos: mock(() => repos),
	persistScores: mock(
		async (runId: number, repoId: number, scores: unknown) => {
			persistCalls.push({ runId, repoId, scores });
		},
	),
	planMembership: mock((_repo: RepoRow) => ({
		finalPlanned: planResult.finalPlanned,
		changed: planResult.changed,
		blocked: planResult.blocked,
		blockReason: planResult.blockReason ?? null,
		fallbackUsed: planResult.fallbackUsed ?? null,
	})),
};

const listsService = {
	read: {
		getListDefs: mock(async () => [
			{ slug: "alpha", name: "Alpha", description: "A" },
			{ slug: "beta", name: "Beta" },
		]),
		currentMembership: mock(
			async (repoId: number) => currentMembership.get(repoId) ?? [],
		),
		mapSlugsToGhIds: mock(async (slugs: string[]) =>
			slugs.map((slug) => `${slug}-gid`),
		),
	},
	apply: {
		ensureListGhIds: mock(async () => {}),
		ensureRepoGhId: mock(
			async (_token: string, repoId: number) => `repo-${repoId}`,
		),
		updateOnGitHub: mock(
			async (_token: string, repoGlobalId: string, targetListIds: string[]) => {
				if (includeApplyError) throw new Error("apply failed");
				updateCalls.push({ repoGlobalId, targetListIds });
			},
		),
		reconcileLocal: mock(async () => {}),
	},
};

const scoreRepoAgainstLists = mock(
	async (lists: unknown, repo: unknown, llm: unknown) => {
		scoreCallArgs.push({ lists, repo, llm });
		return { scores: [{ list: "alpha", score: 0.9, why: "fits" }] };
	},
);

mock.module("@features/scoring", () => ({
	DEFAULT_POLICY: { thresholds: {} },
	createScoringService: () => scoringService,
}));
mock.module("@features/lists", () => ({
	createListsService: () => listsService,
}));
mock.module("@features/scoring/llm", () => ({
	scoreRepoAgainstLists,
}));
mock.module("./public.types", () => ({
	buildBatchStats,
	createScoringLLMFromConfig: () => llmToReturn,
	resolveGithubToken,
	resolveModelConfig,
}));

const { rankAll, rankOne } = await import("./ranking.public");

afterAll(() => {
	mock.restore();
});

let db: Database;

beforeAll(() => {
	db = createDb(":memory:");
	initSchema(db);
	db.exec(
		`INSERT INTO list(id, list_id, name, slug, is_private) VALUES (1,'L1','Alpha','alpha',0);`,
	);
	db.exec(
		`INSERT INTO repo(id, repo_id, name_with_owner, url, description, primary_language, topics, summary, stars, forks, popularity, freshness, activeness)
         VALUES (1,'R_1','org/one','https://github.com/org/one','Repo','TypeScript','["testing"]','Summary',10,2,0.5,0.6,0.7);`,
	);
});

beforeEach(() => {
	repos = [baseRepo(1, "org/one"), baseRepo(2, "org/two")];
	planResult = {
		finalPlanned: ["alpha"],
		changed: true,
		blocked: false,
		blockReason: null,
		fallbackUsed: null,
	};
	currentMembership = new Map([
		[1, ["alpha"]],
		[2, []],
	]);
	persistCalls = [];
	updateCalls = [];
	scoreCallArgs = [];
	includeApplyError = false;
	llmToReturn = { generatePromptAndSend: async () => ({}) };
	scoreRepoAgainstLists.mockClear();
});

afterEach(() => {
	scoringService.resolveRunContext.mockClear();
	scoringService.selectRepos.mockClear();
	scoringService.persistScores.mockClear();
	scoringService.planMembership.mockClear();
	listsService.read.getListDefs.mockClear();
	listsService.read.currentMembership.mockClear();
	listsService.read.mapSlugsToGhIds.mockClear();
	listsService.apply.ensureListGhIds.mockClear();
	listsService.apply.ensureRepoGhId.mockClear();
	listsService.apply.updateOnGitHub.mockClear();
	listsService.apply.reconcileLocal.mockClear();
});

describe("rankAll", () => {
	it("returns ok results in dry run using modelConfig", async () => {
		const progressEvents: unknown[] = [];
		const result = await rankAll({
			dry: true,
			modelConfig: { model: "stub" },
			db,
			onProgress: (evt) => progressEvents.push(evt),
		});

		expect(scoreRepoAgainstLists).toHaveBeenCalledTimes(2);
		expect(scoreCallArgs[0].llm).toBe(llmToReturn);
		expect(result.items).toHaveLength(2);
		expect(result.items.every((item) => item.status === "ok")).toBeTrue();
		expect(result.items[0].scores?.[0].list).toBe("alpha");
		expect(result.stats).toEqual({
			processed: 2,
			succeeded: 2,
			failed: 0,
			saved: 0,
		});
		expect(progressEvents).toHaveLength(2);
		expect(progressEvents[0]).toMatchObject({
			phase: "ranking:repo",
			index: 1,
			total: 2,
		});
	});

	it("marks items as error when scoring throws", async () => {
		scoreRepoAgainstLists.mockImplementationOnce(async () => {
			throw new Error("llm failed");
		});

		const result = await rankAll({ dry: true, modelConfig: { model: "stub" } });

		expect(result.items[0].status).toBe("error");
		expect(result.items[0].error).toBe("llm failed");
	});

	it("returns empty payload when selectRepos finds none", async () => {
		repos = [];

		const result = await rankAll({ dry: true, modelConfig: { model: "stub" } });

		expect(result.items).toHaveLength(0);
		expect(result.stats).toEqual({
			processed: 0,
			succeeded: 0,
			failed: 0,
			saved: 0,
		});
	});
});

describe("rankOne", () => {
	beforeEach(() => {
		Bun.env.GITHUB_TOKEN = "token";
	});

	afterEach(() => {
		delete Bun.env.GITHUB_TOKEN;
	});

	it("applies membership updates when dry=false", async () => {
		const result = await rankOne({
			selector: "org/one",
			dry: false,
			modelConfig: { model: "stub" },
			db,
		});

		expect(result.status).toBe("ok");
		expect(result.scoresPersisted).toBeTrue();
		expect(result.membershipApplied).toBeTrue();
		expect(persistCalls).toHaveLength(1);
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0].repoGlobalId).toBe("repo-1");
		expect(updateCalls[0].targetListIds).toEqual(["alpha-gid"]);
	});

	it("returns enriched error when apply fails", async () => {
		includeApplyError = true;

		const result = await rankOne({
			selector: "org/one",
			dry: false,
			modelConfig: { model: "stub" },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.plannedLists).toEqual(["alpha"]);
		expect(result.error).toBe("apply failed");
	});

	it("uses custom llm when provided", async () => {
		const custom = { generatePromptAndSend: async () => ({}) };

		await rankOne({ selector: "org/one", dry: true, llm: custom, db });

		expect(scoreCallArgs[0].llm).toBe(custom);
	});

	it("handles repo not found", async () => {
		const result = await rankOne({
			selector: "unknown/repo",
			dry: true,
			modelConfig: { model: "stub" },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.error).toBe("repo not found");
	});

	it("propagates ConfigError when token missing for apply", async () => {
		delete Bun.env.GITHUB_TOKEN;

		const result = await rankOne({
			selector: "org/one",
			dry: false,
			modelConfig: { model: "stub" },
			db,
		});

		expect(result.status).toBe("error");
		expect(result.error).toContain("GITHUB_TOKEN");
	});
});
