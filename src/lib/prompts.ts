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

type PromptsConfig = {
	scoring?: {
		system?: string;
		fewshot?: string;
		criteria?: string;
	};
	summarise?: {
		one_paragraph?: string;
		map_header?: string;
		reduce?: string;
	};
};

type SectionKey = keyof PromptsConfig;

const SCORING_KEYS = new Set<keyof NonNullable<PromptsConfig["scoring"]>>([
	"system",
	"fewshot",
	"criteria",
]);
const SUMMARISE_KEYS = new Set<keyof NonNullable<PromptsConfig["summarise"]>>([
	"one_paragraph",
	"map_header",
	"reduce",
]);

type BlockState = {
	section: SectionKey;
	key: string;
	indent: number;
	lines: Array<{ raw: string; indent: number; blank: boolean }>;
	minIndent: number | null;
};

function assignSectionValue(
	target: PromptsConfig,
	section: SectionKey,
	key: string,
	value: string,
): void {
	if (section === "scoring") {
		if (!SCORING_KEYS.has(key as keyof NonNullable<PromptsConfig["scoring"]>)) {
			return;
		}
		if (!target.scoring) {
			target.scoring = {};
		}
		target.scoring[key as keyof PromptsConfig["scoring"]] = value;
	} else if (section === "summarise") {
		if (
			!SUMMARISE_KEYS.has(key as keyof NonNullable<PromptsConfig["summarise"]>)
		) {
			return;
		}
		if (!target.summarise) {
			target.summarise = {};
		}
		target.summarise[key as keyof PromptsConfig["summarise"]] = value;
	}
}

function stripInlineComment(raw: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			continue;
		}
		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			continue;
		}
		if (ch === "#" && !inSingle && !inDouble) {
			return raw.slice(0, i).trimEnd();
		}
	}
	return raw.trim();
}

function parseInlineValue(raw: string): string {
	const trimmed = stripInlineComment(raw);
	if (!trimmed) return "";
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parsePromptsConfig(text: string): PromptsConfig {
	const normalized = text.replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	const config: PromptsConfig = {};

	let section: SectionKey | undefined;
	let block: BlockState | null = null;

	const flushBlock = () => {
		if (!block) return;
		const baseIndent = block.minIndent ?? block.indent + 2;
		const value = block.lines
			.map((entry) => {
				if (entry.blank) return "";
				const sliceFrom = Math.min(entry.raw.length, baseIndent);
				return entry.raw.slice(sliceFrom);
			})
			.join("\n");
		assignSectionValue(config, block.section, block.key, value);
		block = null;
	};

	const processLine = (rawLine: string) => {
		const indentMatch = /^ */.exec(rawLine);
		const indent = indentMatch ? indentMatch[0].length : 0;
		const trimmed = rawLine.trim();

		if (block) {
			if (!trimmed.length) {
				block.lines.push({ raw: "", indent: block.indent + 1, blank: true });
				return;
			}
			if (indent > block.indent) {
				block.lines.push({ raw: rawLine, indent, blank: false });
				block.minIndent =
					block.minIndent === null ? indent : Math.min(block.minIndent, indent);
				return;
			}
			flushBlock();
			processLine(rawLine);
			return;
		}

		if (!trimmed.length || trimmed.startsWith("#")) {
			return;
		}

		if (indent === 0) {
			if (trimmed.endsWith(":")) {
				const key = trimmed.slice(0, -1).trim();
				if (key === "scoring" || key === "summarise") {
					section = key as SectionKey;
				} else {
					section = undefined;
				}
			}
			return;
		}

		if (!section) return;

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) return;
		const key = trimmed.slice(0, colonIdx).trim();
		const valuePart = trimmed.slice(colonIdx + 1).trim();
		if (!key) return;

		if (valuePart.startsWith("|") || valuePart.startsWith(">")) {
			block = {
				section,
				key,
				indent,
				lines: [],
				minIndent: null,
			};
			return;
		}

		assignSectionValue(config, section, key, parseInlineValue(valuePart));
	};

	for (const rawLine of lines) {
		processLine(rawLine);
	}
	if (block) flushBlock();

	return config;
}

// Export parsed root prompts.yaml for consumers that need configuration text.
// This import path resolves from src/lib → project root (../../prompts.yaml).
// Keeping it centralized here ensures all features use the same source.
function loadPromptsConfig(): PromptsConfig {
	const promptsPath = resolve(process.cwd(), "prompts.yaml");
	if (!existsSync(promptsPath)) {
		return {};
	}

	try {
		const text = readFileSync(promptsPath, "utf-8");
		const parsed = parsePromptsConfig(text);
		if (parsed) {
			return parsed;
		}
	} catch {
		// fall through
	}

	return {};
}

export const promptsConfig = loadPromptsConfig();
