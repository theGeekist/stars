import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "@lib/bootstrap";

function resolvePromptsPath(): string {
	return resolve(process.cwd(), "prompts.yaml");
}

export type PromptsState =
	| { kind: "missing" }
	| { kind: "invalid"; reason: string }
	| { kind: "incomplete"; placeholderCount: number; criteriaLines: number }
	| { kind: "ready"; criteriaLines: number };

export function criteriaExamples(): string[] {
	return [
		"productivity = only score if the repo saves time or automates repetitive tasks in any domain (e.g. work, study, daily life).",
		"monetise = only score if the repo explicitly helps generate revenue, enable payments, or provide monetisation strategies (business, commerce, content, services).",
		"networking = only score if the repo explicitly builds or supports communities, connections, or collaboration (social, professional, or technical).",
		"ai = only score if the repo’s primary focus is AI/ML models, frameworks, applications, or tooling.",
		"blockchain-finance = only score if the repo is about blockchain, crypto, DeFi, financial systems, or digital assets.",
		"learning = only score if the repo explicitly teaches through courses, tutorials, exercises, or curricula (any subject, not just programming).",
		"self-marketing = only score if the repo explicitly promotes an individual (portfolio, profile, blogging, personal branding, analytics).",
		"team-management = only score if the repo explicitly helps manage, scale, or structure teams (onboarding, communication, rituals, project or workforce management).",
	];
}

/** Load and validate prompts.yaml from the current working directory. */
function loadPromptsConfig(): PromptsLoadResult {
	try {
		const parsed = Bun.YAML.parse(readFileSync(resolvePromptsPath(), "utf-8"));
		if (!isRecord(parsed))
			return {
				kind: "invalid",
				reason: "prompts.yaml must contain a YAML mapping",
			};
		const scoring = parsed.scoring;
		if (!isRecord(scoring) || typeof scoring.criteria !== "string")
			return { kind: "invalid", reason: "missing scoring.criteria" };
		for (const key of ["system", "fewshot"] as const) {
			if (typeof scoring[key] !== "string" || !scoring[key].trim())
				return { kind: "invalid", reason: `missing scoring.${key}` };
		}
		const summarise = parsed.summarise;
		if (!isRecord(summarise))
			return { kind: "invalid", reason: "missing summarise prompts" };
		for (const key of ["one_paragraph", "map_header", "reduce"] as const) {
			if (typeof summarise[key] !== "string" || !summarise[key].trim())
				return { kind: "invalid", reason: `missing summarise.${key}` };
		}
		return { kind: "ready", config: parsed as PromptsConfig };
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT")
			return { kind: "missing" };
		return {
			kind: "invalid",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

export type PromptsConfig = {
	scoring?: {
		system?: string;
		fewshot?: string;
		/** Raw multi-line block where each line is "slug = only score if ..." */
		criteria?: string;
	};
	summarise?: { one_paragraph?: string; map_header?: string; reduce?: string };
};

type PromptsLoadResult =
	| { kind: "ready"; config: PromptsConfig }
	| { kind: "missing" }
	| { kind: "invalid"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

/** Return the parsed configuration, re-reading the file on each call. */
export function getPromptsConfig(): PromptsConfig {
	const loaded = loadPromptsConfig();
	if (loaded.kind === "missing") throw new Error("prompts.yaml not found");
	if (loaded.kind === "invalid")
		throw new Error(`prompts.yaml invalid: ${loaded.reason}`);
	return loaded.config;
}

/** Evaluate the current configuration and count non-comment criteria lines. */
export function checkPromptsState(): PromptsState {
	const loaded = loadPromptsConfig();
	if (loaded.kind !== "ready") return loaded;
	const criteria = loaded.config.scoring?.criteria;
	if (typeof criteria !== "string")
		return { kind: "invalid", reason: "missing scoring.criteria" };

	const lines = criteria
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
	const placeholderCount = lines.filter(
		(line) => /TODO:/.test(line) || /placeholder:\s*true/i.test(line),
	).length;

	if (lines.length === 0)
		return { kind: "incomplete", placeholderCount: 0, criteriaLines: 0 };
	if (placeholderCount > 0)
		return {
			kind: "incomplete",
			placeholderCount,
			criteriaLines: lines.length,
		};
	return { kind: "ready", criteriaLines: lines.length };
}

export function printSetupStatus(state: PromptsState): void {
	switch (state.kind) {
		case "ready":
			log.success(`prompts.yaml ready (${state.criteriaLines} criteria lines)`);
			break;
		case "incomplete":
			log.warn(
				`prompts.yaml incomplete — ${state.criteriaLines} criteria lines, ${state.placeholderCount} placeholder${state.placeholderCount === 1 ? "" : "s"}.`,
			);
			break;
		case "invalid":
			log.error(`prompts.yaml invalid: ${state.reason}`);
			break;
		case "missing":
			log.error("prompts.yaml not found.");
			break;
	}
}

export async function showSetupHintIfNotReady(): Promise<void> {
	const state = checkPromptsState();
	if (state.kind === "ready") return;

	log.header("Setup");
	switch (state.kind) {
		case "missing":
			log.error("prompts.yaml not found.");
			break;
		case "invalid":
			log.error(`prompts.yaml invalid: ${state.reason}`);
			break;
		case "incomplete":
			log.warn(
				`prompts.yaml incomplete — ${state.criteriaLines} criteria lines, ${state.placeholderCount} placeholder${state.placeholderCount === 1 ? "" : "s"}.`,
			);
			break;
	}
	log.line("");
	log.subheader("Run");
	log.line("  gk-stars setup");
	log.line("");
	log.subheader("Or edit");
	log.line("  <root>/prompts.yaml");
	log.line("");
	log.subheader("Criteria style examples");
	log.list(criteriaExamples());
	log.line("");
}

export function ensurePromptsReadyOrExit(): void {
	const state = checkPromptsState();
	if (state.kind === "ready") return;
	printSetupStatus(state);
	log.line("Edit <root>/prompts.yaml or run: gk-stars setup");
	process.exit(1);
}
