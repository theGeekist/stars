import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "@lib/bootstrap";

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

/** Detect `scoring:\n  criteria: |` block and count non-comment lines. */
export function checkPromptsState(): PromptsState {
	const promptsPath = resolve(process.cwd(), "prompts.yaml");
	if (!existsSync(promptsPath)) return { kind: "missing" };

	let text = "";
	try {
		text = readFileSync(promptsPath, "utf-8");
	} catch {
		return { kind: "invalid", reason: "cannot read prompts.yaml" };
	}

	const scoringIdx = text.indexOf("\nscoring:");
	const criteriaIdx = text.indexOf(
		"\n  criteria:",
		scoringIdx >= 0 ? scoringIdx : 0,
	);
	if (criteriaIdx === -1)
		return { kind: "invalid", reason: "missing scoring.criteria" };

	const lineEnd = text.indexOf("\n", criteriaIdx + 1);
	const nextTop = text.indexOf(
		"\nsummarise:",
		lineEnd === -1 ? criteriaIdx : lineEnd,
	);
	const sectionEnd = nextTop === -1 ? text.length : nextTop;

	const criteriaLine = text.slice(
		criteriaIdx,
		lineEnd === -1 ? criteriaIdx + 1 : lineEnd,
	);
	const isBlock = /\|\s*$/.test(criteriaLine);
	if (!isBlock) {
		return {
			kind: "invalid",
			reason: "scoring.criteria must be a block string (use `|`)",
		};
	}

	const body = text.slice(lineEnd + 1, sectionEnd);
	const lines = body
		.split("\n")
		.map((l) => l.replace(/\r$/, ""))
		.map((l) => (l.startsWith("    ") ? l.slice(4) : l));

	const effective = lines.filter((l) => {
		const s = l.trim();
		if (!s) return false;
		if (s.startsWith("#")) return false;
		return true;
	});

	const placeholderCount = effective.filter(
		(l) => /TODO:/.test(l) || /placeholder:\s*true/i.test(l),
	).length;

	if (effective.length === 0)
		return { kind: "incomplete", placeholderCount: 0, criteriaLines: 0 };
	if (placeholderCount > 0) {
		return {
			kind: "incomplete",
			placeholderCount,
			criteriaLines: effective.length,
		};
	}
	return { kind: "ready", criteriaLines: effective.length };
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
