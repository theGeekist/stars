// src/lib/score.ts
import { OllamaService } from "@jasonnathan/llm-core";
import { toNum } from "./utils";

export type ListDef = {
	slug: string; // e.g. "ai"
	name: string; // e.g. "AI"
	description?: string | null;
};

export type RepoFacts = {
	nameWithOwner: string; // owner/repo
	url: string;
	summary?: string | null; // your ≤100 words summary
	description?: string | null;
	primaryLanguage?: string | null;
	topics?: string[];
};

export type ScoreItem = { list: string; score: number; why?: string };
export type ScoreResponse = { scores: ScoreItem[] };

function buildSchema(slugs: string[]): Record<string, unknown> {
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
						list: { type: "string", enum: slugs }, // ← constrain to slugs
						score: { type: "number", minimum: 0, maximum: 1 },
						why: { type: "string" },
					},
				},
			},
		},
	};
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

const SYSTEM_PROMPT = `You are a neutral curator for a github repositories.`;

function validateAndRepair(
	r: unknown,
	validSlugs: Set<string>,
): ScoreResponse | false {
	const out: ScoreItem[] = [];

	const items = (r as any)?.scores;
	if (!Array.isArray(items)) return false;

	for (const it of items) {
		let list = typeof it?.list === "string" ? it.list.trim() : "";
		let score = toNum(it?.score);
		const why =
			typeof it?.why === "string"
				? it.why.trim().replace(/\s+/g, " ")
				: undefined;

		// small name→slug normalisations (just in case)
		const lower = list.toLowerCase();
		if (!validSlugs.has(list)) {
			// try naïve slugify: "React Hooks" -> "react-hooks"
			const guess = lower.replace(/\s+/g, "-");
			if (validSlugs.has(guess)) list = guess;
		}

		if (!validSlugs.has(list)) continue; // drop unknown
		if (score == null) continue; // drop unusable
		if (score < 0) score = 0; // clamp
		if (score > 1) score = 1;

		out.push({ list, score, why });
	}

	if (!out.length) return false; // still nothing usable
	return { scores: out };
}

export async function scoreRepoAgainstLists(
	llm: OllamaService,
	lists: ListDef[],
	repo: RepoFacts,
): Promise<ScoreResponse> {
	const slugs = lists.map((l) => l.slug);
	const schema = buildSchema(slugs);
	const userPrompt =
		`Your task is to score the repository against EACH list from 0 to 1. where 1 = perfect fit. Multiple lists may apply. Provide a reason why for repos that meet the criteria. 
Scoring Guide (if the repo does not or barely meets the criteria, score **MUST** be < 0.5):
	productivity = only score if the repo saves time or automates repetitive tasks in any domain (e.g. work, study, daily life).  
	monetise = only score if the repo **explicitly** helps generate revenue, enable payments, or provide monetisation strategies (business, commerce, content, services).  
	networking = only score if the repo **explicitly** builds or supports communities, connections, or collaboration (social, professional, or technical).  
	ai = only score if the repo’s **primary** focus is AI/ML models, frameworks, applications, or tooling.  
	blockchain-finance = only score if the repo is about blockchain, crypto, DeFi, financial systems, or digital assets.  
	learning = only score if the repo **explicitly** teaches through **courses, tutorials, exercises, or curricula** (any subject, not just programming).  
	self-marketing = only score if the repo **explicitly** promotes an individual (portfolio, profile, blogging, personal branding, analytics).  
	team-management = only score if the repo **explicitly** helps manage, scale, or structure teams (onboarding, communication, rituals, project or workforce management).  
  

Lists:
  ${listsBlock(lists)}

${FEWSHOT}

Repository to score:
  ${repoBlock(repo)}
  `.trim();

	// The client sends `format: schema` to Ollama; no JSON instructions needed in prompt.
	const res = await llm.generatePromptAndSend<ScoreResponse>(
		SYSTEM_PROMPT,
		userPrompt,
		{ schema },
		(r) => {
			// light custom check: ensure lists are valid and scores in range
			const slugs = new Set(lists.map((l) => l.slug));
			const valid = validateAndRepair(r, slugs);
			return valid ? r : false;
		},
	);
	return res;
}

export function diffMembership(
	currentSlugs: string[],
	scores: ScoreItem[],
	addThreshold = 0.7,
	removeThreshold = 0.3,
	topK = 3,
) {
	const current = new Set(currentSlugs);
	const sorted = [...scores].sort((a, b) => b.score - a.score);
	const top = sorted.slice(0, topK);

	const add = sorted.filter(
		(s) => s.score >= addThreshold && !current.has(s.list),
	);
	const remove = sorted.filter(
		(s) => s.score <= removeThreshold && current.has(s.list),
	);
	const keep = sorted.filter(
		(s) => s.score > removeThreshold && current.has(s.list),
	);
	const review = sorted.filter(
		(s) =>
			!current.has(s.list) &&
			s.score > removeThreshold &&
			s.score < addThreshold,
	);

	return { top, add, remove, keep, review };
}
