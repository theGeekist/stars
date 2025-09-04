// src/cli.ts
// Unified CLI entry with subcommands: lists, stars, unlisted, score, summarise, ingest, topics:enrich, setup

import { initBootstrap, log } from "@lib/bootstrap";
import { parseSimpleArgs, SIMPLE_USAGE } from "@lib/cli";
import {
	checkPromptsState,
	criteriaExamples,
	ensurePromptsReadyOrExit,
	printSetupStatus,
	showSetupHintIfNotReady,
} from "@lib/prompts";
import { scoreBatchAll, scoreOne } from "@src/cli-scorer";
import { runLists, runRepos, runStars, runUnlisted } from "@src/cli-stars";
import { summariseBatchAll, summariseOne } from "@src/cli-summarise";
import ingest from "@src/ingest";
import { enrichAllRepoTopics } from "@src/topics";
import { topicsReport } from "@src/topics-report";

/* ----------------------------- Usage banner ----------------------------- */
initBootstrap();
function usage(): void {
	log.header("gk-stars");

	log.subheader("Usage");
	log.list([
		"gk-stars lists [--json] [--out <file>] [--dir <folder>]",
		"gk-stars repos --list <name> [--json]",
		"gk-stars stars [--json] [--out <file>] [--dir <folder>]",
		"gk-stars unlisted [--json] [--out <file>]",
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

/* -------------------------- Command handlers --------------------------- */

async function handleLists(args: string[]): Promise<void> {
	let json = false;
	let out: string | undefined;
	let dir: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--json") json = true;
		else if (a === "--out" && args[i + 1]) {
			i += 1;
			out = args[i];
		} else if (a === "--dir" && args[i + 1]) {
			i += 1;
			dir = args[i];
		}
	}
	await runLists(json, out, dir);
}

async function handleRepos(args: string[]): Promise<void> {
	let list: string | undefined;
	let json = false;
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--list" && args[i + 1]) {
			i += 1;
			list = args[i];
		} else if (a === "--json") json = true;
	}
	if (!list) {
		log.error("--list <name> is required");
		process.exit(1);
	}
	await runRepos(list, json);
}

async function handleStars(args: string[]): Promise<void> {
	let json = false;
	let out: string | undefined;
	let dir: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--json") json = true;
		else if (a === "--out" && args[i + 1]) {
			i += 1;
			out = args[i];
		} else if (a === "--dir" && args[i + 1]) {
			i += 1;
			dir = args[i];
		}
	}
	await runStars(json, out, dir);
}

async function handleUnlisted(args: string[]): Promise<void> {
	let json = false;
	let out: string | undefined;
	let dir: string | undefined; // ← add
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--json") json = true;
		else if (a === "--out" && args[i + 1]) {
			i += 1;
			out = args[i];
		} else if (a === "--dir" && args[i + 1]) {
			i += 1;
			dir = args[i];
		} // ← add
	}
	await runUnlisted(json, out, dir); // ← pass dir
}

async function handleScore(argv: string[], args: string[]): Promise<void> {
	ensurePromptsReadyOrExit();
	const s = parseSimpleArgs(argv);
	let resume: number | "last" | undefined;
	let notes: string | undefined;
	let fresh = false;
	let dry = s.dry;
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--resume" && args[i + 1]) {
			i += 1;
			const v = args[i];
			resume =
				v === "last"
					? "last"
					: Number.isFinite(Number(v))
						? Number(v)
						: undefined;
			continue;
		}
		if (a === "--notes" && args[i + 1]) {
			i += 1;
			notes = args[i];
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
			`Score --all limit=${limit} apply=${apply}${resume ? ` resume=${resume}` : ""}${fresh ? " fresh=true" : ""}${notes ? " notes=..." : ""}`,
		);
		await scoreBatchAll(limit, apply);
	}
}

async function handleSummarise(argv: string[], args: string[]): Promise<void> {
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
			`Summarise --all limit=${limit} apply=${apply}${resummarise ? " resummarise=true" : ""}`,
		);
		await summariseBatchAll(limit, apply, undefined, { resummarise });
	}
}

async function handleIngest(args: string[]): Promise<void> {
	const dirIdx = args.indexOf("--dir");
	const dir =
		dirIdx > -1 && args[dirIdx + 1]
			? args[dirIdx + 1]
			: (Bun.env.EXPORTS_DIR ?? "./exports");
	await ingest(dir);
}

function handleTopicsEnrich(args: string[]): void {
	const onlyActive = args.includes("--active");
	const ttlIdx = args.indexOf("--ttl");
	const ttl =
		ttlIdx > -1 && args[ttlIdx + 1] ? Number(args[ttlIdx + 1]) : undefined;
	log.info(
		`Enrich topics: onlyActive=${onlyActive} ttlDays=${ttl ?? "(default)"}`,
	);
	enrichAllRepoTopics({ onlyActive, ttlDays: ttl });
}

async function handleTopicsReport(args: string[]): Promise<void> {
	const showMissing = args.includes("--missing");
	const showRecent = args.includes("--recent");
	const json = args.includes("--json");
	const full = args.includes("--full");
	await topicsReport({ full, showMissing, showRecent, json });
}

async function handleSetup(): Promise<void> {
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
		log.info("Continuing with placeholders. Fill criteria manually. Examples:");
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
			return showSetupHintIfNotReady();

		case "lists":
			return handleLists(args);

		case "repos":
			return handleRepos(args);

		case "stars":
			return handleStars(args);

		case "unlisted":
			return handleUnlisted(args);

		case "score":
			return handleScore(argv, args);

		case "summarise":
		case "summarize":
			return handleSummarise(argv, args);

		case "ingest":
			return handleIngest(args);

		case "topics:enrich":
			return handleTopicsEnrich(args);

		case "topics:report":
			return handleTopicsReport(args);

		case "setup":
			return handleSetup();

		default:
			usage();
			return showSetupHintIfNotReady();
	}
}

if (import.meta.main) {
	await main(Bun.argv).catch((e) => {
		log.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	});
}
// For tests: allow calling the router without executing as main
export { main as _testMain };
