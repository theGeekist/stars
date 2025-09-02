import { OllamaService } from "@jasonnathan/llm-core";
import { toNum } from "@lib/utils";
import type { MaybeOllama } from "./types";

/* ---------- Public types ---------- */

export type ListDef = {
	slug: string;
	name: string;
	description?: string | null;
};

export type RepoFacts = {
	nameWithOwner: string;
	url: string;
	summary?: string | null;
	description?: string | null;
	primaryLanguage?: string | null;
	topics?: string[];
};

export type ScoreItem = { list: string; score: number; why?: string };
export type ScoreResponse = { scores: ScoreItem[] };

/* ---------- LLM interface (simple) ---------- */

export type ScoringLLM = {
	generatePromptAndSend(
		system: string,
		user: string,
		opts?: { schema?: unknown },
	): Promise<unknown>;
};

function defaultLLM(): ScoringLLM {
	const svc = new OllamaService(
		Bun.env.OLLAMA_MODEL ?? "",
	) as unknown as MaybeOllama;
	return {
		async generatePromptAndSend(system, user, opts) {
			if (
				"generatePromptAndSend" in svc &&
				typeof svc.generatePromptAndSend === "function"
			) {
				return svc.generatePromptAndSend(system, user, opts);
			}
			if ("send" in svc && typeof svc.send === "function") {
				return svc.send(system, user, opts);
			}
			throw new Error("OllamaService: no compatible send method");
		},
	};
}

/* ---------- Tiny helpers ---------- */

function buildSchema(slugs: string[]): unknown {
	return {
		type: "object",
		required: ["scores"],
		properties: {
			scores: {
				type: "array",
				items: {
					type: "object",
					required: ["list", "score"],
					properties: {
						list: { type: "string", enum: slugs },
						score: { type: "number", minimum: 0, maximum: 1 },
						why: { type: "string" },
					},
					additionalProperties: false,
				},
			},
		},
		additionalProperties: false,
	} as const;
}

function listsBlock(lists: ListDef[]): string {
	return lists
		.map((l) => `- ${l.name} (${l.slug}) - ${l.description ?? ""}`.trim())
		.join("\n");
}

const FEWSHOT = `
Examples (format matches schema):

Repo:
"CLI that cross-posts your blog posts to Dev.to, Hashnode and Medium; manages canonical URLs; adds UTM; syncs updates."

Expected JSON:
{
  "scores": [
    { "list": "self-marketing", "score": 0.8, "why": "Publishing & cross-posting are personal promotion workflows." },
    { "list": "productivity", "score": 0.4, "why": "CLI automation helps, but promotion is the primary goal." },
    { "list": "learning", "score": 0.0 }
  ]
}

Repo:
"Task-runner that automates image optimisation and builds; speeds up local dev commands; no publishing features."

Expected JSON:
{
  "scores": [
    { "list": "productivity", "score": 0.9, "why": "Developer time-saver for day-to-day workflows." },
    { "list": "self-marketing", "score": 0.1, "why": "Not focused on promoting an individual." },
    { "list": "learning", "score": 0.0 }
  ]
}
`.trim();

function repoBlock(r: RepoFacts): string {
	const bits = [
		`Name: ${r.nameWithOwner}`,
		`URL: ${r.url}`,
		r.primaryLanguage ? `Primary language: ${r.primaryLanguage}` : "",
		r.topics?.length ? `Topics: ${r.topics.join(", ")}` : "",
		r.description ? `Description: ${r.description}` : "",
		r.summary ? `Summary: ${r.summary}` : "",
	].filter(Boolean);
	return bits.join("\n");
}

/* ---------- Minimal validation/repair (no any) ---------- */

function isRecord(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null;
}

function getProp(obj: Record<string, unknown>, key: string): unknown {
	return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function getStr(obj: Record<string, unknown>, key: string): string | undefined {
	const v = getProp(obj, key);
	return typeof v === "string" ? v : undefined;
}

function validateAndRepair(
	input: unknown,
	validSlugs: Set<string>,
): ScoreResponse | false {
	if (!isRecord(input)) return false;

	const scoresUnknown = getProp(input, "scores");
	if (!Array.isArray(scoresUnknown)) return false;

	const out: ScoreItem[] = [];

	for (const item of scoresUnknown) {
		if (!isRecord(item)) continue;

		// list
		const listRaw = getStr(item, "list")?.trim() ?? "";
		let list = listRaw;
		if (!validSlugs.has(list)) {
			const guess = list.toLowerCase().replace(/\s+/g, "-");
			if (validSlugs.has(guess)) list = guess;
		}
		if (!validSlugs.has(list)) continue;

		// score
		const scoreUnknown = getProp(item, "score");
		let score = toNum(scoreUnknown);
		if (score == null || Number.isNaN(score)) continue;
		if (score < 0) score = 0;
		if (score > 1) score = 1;

		// why
		const whyStr = getStr(item, "why");
		const why = whyStr ? whyStr.trim().replace(/\s+/g, " ") : undefined;

		out.push({ list, score, why });
	}

	return out.length ? { scores: out } : false;
}

/* ---------- Prompt + main ---------- */

const SYSTEM_PROMPT = `You are a neutral curator for github repositories.`;

export async function scoreRepoAgainstLists(
	lists: ListDef[],
	repo: RepoFacts,
	llm: ScoringLLM = defaultLLM(),
): Promise<ScoreResponse> {
	const slugs = lists.map((l) => l.slug);
	const schema = buildSchema(slugs);

	const userPrompt = `
Your task is to score the repository against EACH list from 0 to 1, where 1 = perfect fit. Multiple lists may apply. Provide a reason why for repos that meet the criteria.
Scoring Guide (if the repo does not or barely meets the criteria, score MUST be < 0.5):
  productivity = only score if the repo saves time or automates repetitive tasks in any domain (e.g. work, study, daily life).
  monetise = only score if the repo explicitly helps generate revenue, enable payments, or provide monetisation strategies (business, commerce, content, services).
  networking = only score if the repo explicitly builds or supports communities, connections, or collaboration (social, professional, or technical).
  ai = only score if the repo’s primary focus is AI/ML models, frameworks, applications, or tooling.
  blockchain-finance = only score if the repo is about blockchain, crypto, DeFi, financial systems, or digital assets.
  learning = only score if the repo explicitly teaches through courses, tutorials, exercises, or curricula (any subject, not just programming).
  self-marketing = only score if the repo explicitly promotes an individual (portfolio, profile, blogging, personal branding, analytics).
  team-management = only score if the repo explicitly helps manage, scale, or structure teams (onboarding, communication, rituals, project or workforce management).

Lists:
${listsBlock(lists)}

${FEWSHOT}

Repository to score:
${repoBlock(repo)}
  `.trim();

	const raw = await llm.generatePromptAndSend(SYSTEM_PROMPT, userPrompt, {
		schema,
	});
	const repaired = validateAndRepair(raw, new Set(slugs));
	if (!repaired) throw new Error("Invalid LLM response");
	return repaired;
}
