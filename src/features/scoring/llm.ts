// src/llm/scoring.ts
import { OllamaService } from "@jasonnathan/llm-core";
import { promptsConfig as prompts } from "@lib/prompts";
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

/* ---------- LLM interface ---------- */

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

/* ---------- Helpers ---------- */

function requireStr(v: unknown, name: string): string {
	if (typeof v === "string" && v.trim()) return v;
	throw new Error(`${name} missing`);
}

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

/** Parse a block with lines like:
 *  "• productivity = …" or "productivity: …"
 *  returns Map<slug, description>
 */
function parseCriteriaBlock(block: string): Map<string, string> {
	// ───────────────────────────────────────────────────────────────────────────────
	// 1) Key–value lines (":", "=")
	// Before:  /^([a-z0-9-]+)\s*[:=]\s*(.+)$/i
	// Risk:    Greedy (.+) may cause backtracking over long lines.
	// After:   anchor to line; forbid newlines in the value; keep it linear.
	const KV_RE = /^([a-z0-9-]+)\s*[:=]\s*([^\r\n]+)$/iu;
	const map = new Map<string, string>();
	for (const raw of block.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const cleaned = line.replace(/^[•*\-\u2022]\s*/, ""); // strip bullet
		const m = KV_RE.exec(cleaned);
		if (!m) continue;
		map.set(m[1].toLowerCase(), m[2].trim());
	}
	return map;
}

function listsBlockFromCriteria(
	lists: ListDef[],
	criteriaBlock: string,
): string {
	const bySlug = parseCriteriaBlock(criteriaBlock);
	return lists
		.map((l) => {
			const desc = bySlug.get(l.slug);
			return desc
				? `- ${l.name} (${l.slug}) - ${desc}`
				: `- ${l.name} (${l.slug})`;
		})
		.join("\n");
}

/* ---------- Response validation ---------- */

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

/* ---------- Main ---------- */

export async function scoreRepoAgainstLists(
	lists: ListDef[],
	repo: RepoFacts,
	llm: ScoringLLM = defaultLLM(),
): Promise<ScoreResponse> {
	const slugs = lists.map((l) => l.slug);
	const schema = buildSchema(slugs);

	// STRICT: read strings only; throw if missing
	const system = requireStr(prompts?.scoring?.system, "prompts.scoring.system");
	const fewshot = requireStr(
		prompts?.scoring?.fewshot,
		"prompts.scoring.fewshot",
	);
	const criteria = requireStr(
		prompts?.scoring?.criteria,
		"prompts.scoring.criteria",
	);

	const guideText = criteria; // injected verbatim
	const listsText = listsBlockFromCriteria(lists, criteria);

	const userPrompt = `
${guideText}

Lists:
${listsText}

${fewshot}

Repository to score:
${repoBlock(repo)}
  `.trim();

	const raw = await llm.generatePromptAndSend(system, userPrompt, { schema });
	const repaired = validateAndRepair(raw, new Set(slugs));
	if (!repaired) throw new Error("Invalid LLM response");
	return repaired;
}
