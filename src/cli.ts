// src/cli.ts
// Unified CLI entry with subcommands: lists, score, summarise, ingest, topics:enrich, setup

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "@lib/bootstrap";
import { parseSimpleArgs, SIMPLE_USAGE } from "@lib/cli";
import { runLists, runRepos } from "@src/cli-lists";
import { scoreBatchAll, scoreOne } from "@src/cli-scorer";
import { summariseBatchAll, summariseOne } from "@src/cli-summarise";
import { enrichAllRepoTopics } from "@src/enrich-topics";
import ingest from "@src/ingest";
import { topicsReport } from "@src/topics-report";

/* ----------------------------- Usage banner ----------------------------- */

function usage(): void {
	log.header("gk-stars");

	log.subheader("Usage");
	log.list([
		"gk-stars lists [--json] [--out <file>] [--dir <folder>]",
		"gk-stars repos --list <name> [--json]",
		"gk-stars score (--one <owner/repo> | --all [--limit N]) [--dry]",
		"gk-stars summarise (--one <owner/repo> | --all [--limit N]) [--dry]",
		"gk-stars ingest [--dir <folder>]    (defaults EXPORTS_DIR or ./exports)",
		"gk-stars topics:enrich [--active] [--ttl <days>]",
		"gk-stars topics:report [--missing] [--recent] [--json] [--full]",
		"gk-stars setup  # generate prompts.yaml from your GitHub lists",
	]);
	log.line("");

	log.subheader("Quick flags");
	log.line(SIMPLE_USAGE.trim());
	log.line("");
}

/* ------------------------ Prompts readiness helpers ------------------------ */

type PromptsState =
	| { kind: "missing" }
	| { kind: "invalid"; reason: string }
	| { kind: "incomplete"; placeholderCount: number; criteriaLines: number }
	| { kind: "ready"; criteriaLines: number };

function criteriaExamples(): string[] {
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
function checkPromptsState(): PromptsState {
	const promptsPath = resolve(process.cwd(), "prompts.yaml");
	if (!existsSync(promptsPath)) return { kind: "missing" };

	let text = "";
	try {
		text = readFileSync(promptsPath, "utf-8");
	} catch {
		return { kind: "invalid", reason: "cannot read prompts.yaml" };
	}

	// Locate scoring.criteria
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

	// Expect block scalar `criteria: |`
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

	if (effective.length === 0) {
		return { kind: "incomplete", placeholderCount: 0, criteriaLines: 0 };
	}
	if (placeholderCount > 0) {
		return {
			kind: "incomplete",
			placeholderCount,
			criteriaLines: effective.length,
		};
	}
	return { kind: "ready", criteriaLines: effective.length };
}

function printSetupStatus(state: PromptsState): void {
	switch (state.kind) {
		case "ready":
			log.success(`prompts.yaml ready (${state.criteriaLines} criteria lines)`);
			break;
		case "incomplete":
			log.warn(
				`prompts.yaml incomplete — ${state.criteriaLines} criteria lines, ` +
					`${state.placeholderCount} placeholder${
						state.placeholderCount === 1 ? "" : "s"
					}.`,
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

async function showSetupHintIfNotReady(): Promise<void> {
	const state = checkPromptsState();
	if (state.kind === "ready") return;

	log.header("Setup");

	// reuse your existing status line logic
	switch (state.kind) {
		case "missing":
			log.error("prompts.yaml not found.");
			break;
		case "invalid":
			log.error(`prompts.yaml invalid: ${state.reason}`);
			break;
		case "incomplete":
			log.warn(
				`prompts.yaml incomplete — ${state.criteriaLines} criteria lines, ` +
					`${state.placeholderCount} placeholder${
						state.placeholderCount === 1 ? "" : "s"
					}.`,
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

function ensurePromptsReadyOrExit(): void {
	const state = checkPromptsState();
	if (state.kind === "ready") return;

	printSetupStatus(state);
	log.line("Edit <root>/prompts.yaml or run: gk-stars setup");
	process.exit(1);
}

/* --------------------------------- Main CLI -------------------------------- */

async function main(argv: string[]) {
	const args = argv.slice(2);
	const cmd = args[0] ?? "help";

	switch (cmd) {
		case "help":
		case "--help":
		case "-h":
			usage();
			await showSetupHintIfNotReady();
			return;

		case "lists": {
			let json = false;
			let out: string | undefined;
			let dir: string | undefined;
			for (let i = 1; i < args.length; i++) {
				const a = args[i];
				if (a === "--json") json = true;
				else if (a === "--out" && args[i + 1]) out = args[++i];
				else if (a === "--dir" && args[i + 1]) dir = args[++i];
			}
			await runLists(json, out, dir);
			return;
		}

		case "repos": {
			let list: string | undefined,
				json = false;
			for (let i = 1; i < args.length; i++) {
				const a = args[i];
				if (a === "--list" && args[i + 1]) list = args[++i];
				else if (a === "--json") json = true;
			}
			if (!list) {
				log.error("--list <name> is required");
				process.exit(1);
			}
			await runRepos(list, json);
			return;
		}

		case "score": {
			ensurePromptsReadyOrExit();

			const s = parseSimpleArgs(argv);
			let resume: number | "last" | undefined;
			let notes: string | undefined;
			let fresh = false;
			let dry = s.dry;

			for (let i = 1; i < args.length; i++) {
				const a = args[i];
				if (a === "--resume" && args[i + 1]) {
					const v = args[++i];
					resume =
						v === "last"
							? "last"
							: Number.isFinite(Number(v))
								? Number(v)
								: undefined;
					continue;
				}
				if (a === "--notes" && args[i + 1]) {
					notes = args[++i];
					continue;
				}
				if (a === "--fresh" || a === "--from-scratch") {
					fresh = true;
					continue;
				}
				if (a === "--dry") dry = true;
			}

			const apply = s.apply || !dry;
			if (s.mode === "one") {
				if (!s.one) {
					log.error("--one requires a value");
					process.exit(1);
				}
				await scoreOne(s.one, apply);
			} else {
				const limit = Math.max(1, s.limit ?? 999999999);
				log.info(
					`Score --all limit=${limit} apply=${apply}${
						resume ? ` resume=${resume}` : ""
					}${fresh ? " fresh=true" : ""}${notes ? " notes=..." : ""}`,
				);
				await scoreBatchAll(limit, apply, undefined, { resume, notes, fresh });
			}
			return;
		}

		case "summarise":
		case "summarize": {
			ensurePromptsReadyOrExit();

			const s = parseSimpleArgs(argv);
			let resummarise = false;
			let dry = s.dry;
			for (let i = 1; i < args.length; i++) {
				const a = args[i];
				if (a === "--resummarise" || a === "--resummarize") resummarise = true;
				if (a === "--dry") dry = true;
			}
			const apply = s.apply || !dry;
			if (s.mode === "one") {
				if (!s.one) {
					log.error("--one requires a value");
					process.exit(1);
				}
				await summariseOne(s.one, apply);
			} else {
				const limit = Math.max(1, s.limit ?? 999999999);
				log.info(
					`Summarise --all limit=${limit} apply=${apply}${
						resummarise ? " resummarise=true" : ""
					}`,
				);
				await summariseBatchAll(limit, apply, undefined, { resummarise });
			}
			return;
		}

		case "ingest": {
			const dirIdx = args.indexOf("--dir");
			const dir =
				dirIdx > -1 && args[dirIdx + 1]
					? args[dirIdx + 1]
					: (Bun.env.EXPORTS_DIR ?? "./exports");

			await ingest(dir); // pretty reporting happens inside
			return;
		}

		case "topics:enrich": {
			const onlyActive = args.includes("--active");
			const ttlIdx = args.indexOf("--ttl");
			const ttl =
				ttlIdx > -1 && args[ttlIdx + 1] ? Number(args[ttlIdx + 1]) : undefined;
			log.info(
				`Enrich topics: onlyActive=${onlyActive} ttlDays=${ttl ?? "(default)"}`,
			);
			enrichAllRepoTopics({ onlyActive, ttlDays: ttl }); // ← no await
			return;
		}

		case "topics:report": {
			const showMissing = args.includes("--missing");
			const showRecent = args.includes("--recent");
			const json = args.includes("--json");
			const full = args.includes("--full");
			await topicsReport({ full, showMissing, showRecent, json });
			return;
		}
		case "setup": {
			const token = Bun.env.GITHUB_TOKEN;
			if (!token) {
				log.error("GITHUB_TOKEN missing");
				process.exit(1);
			}

			const { generatePromptsYaml, testOllamaReady } = await import(
				"@features/setup"
			);
			const ready = await testOllamaReady();

			if (!ready.ok) {
				log.warn(
					"Ollama not ready to generate criteria:",
					ready.reason ?? "unknown",
				);
				log.line("");
				log.info("To enable automatic criteria generation:");
				log.line(
					"  1) Ensure Ollama is installed and running (e.g. 'ollama serve')",
				);
				log.line(
					"  2) Set OLLAMA_MODEL in your .env, e.g. OLLAMA_MODEL=llama3.1:8b",
				);
				log.line("");
				log.info(
					"Continuing with placeholders. Fill criteria manually. Examples:",
				);
				for (const ex of criteriaExamples()) log.line(`  ${ex}`);
				await generatePromptsYaml(token);
			} else {
				await generatePromptsYaml(token);
			}

			const state = checkPromptsState();
			if (state.kind === "incomplete") {
				log.warn(
					`prompts.yaml contains ${state.placeholderCount} placeholder criteria — edit them before running scoring.`,
				);
			} else {
				printSetupStatus(state);
			}
			return;
		}

		default:
			usage();
			await showSetupHintIfNotReady();
	}
}

if (import.meta.main) {
	await main(Bun.argv).catch((e) => {
		log.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	});
}
