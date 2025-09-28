// src/cli.ts
// Unified CLI entry with subcommands: lists, stars, unlisted, score, summarise, ingest, topics:enrich, setup

import { initBootstrap, log } from "@lib/bootstrap";
import { parseSimpleArgs } from "@lib/cli";
import {
	checkPromptsState,
	criteriaExamples,
	ensurePromptsReadyOrExit,
	printSetupStatus,
	showSetupHintIfNotReady,
} from "@lib/prompts";
import ingest from "@src/api/ingest";
import { DEFAULT_POLICY, rankAll, rankOne } from "@src/api/ranking.public";
import {
	runListsCore,
	runReposCore,
	runStarsCore,
	runUnlistedCore,
} from "@src/api/stars";
import { summariseAll, summariseRepo } from "@src/api/summarise.public";
import { enrichAllRepoTopics } from "@src/api/topics";

type CliDeps = {
	runLists: typeof runListsCore;
	runRepos: typeof runReposCore;
	runStars: typeof runStarsCore;
	runUnlisted: typeof runUnlistedCore;
	rankOne: typeof rankOne;
	rankAll: typeof rankAll;
	summariseRepo: typeof summariseRepo;
	summariseAll: typeof summariseAll;
};

const defaultDeps: CliDeps = {
	runLists: runListsCore,
	runRepos: runReposCore,
	runStars: runStarsCore,
	runUnlisted: runUnlistedCore,
	rankOne,
	rankAll,
	summariseRepo,
	summariseAll,
};

const cliDeps: CliDeps = { ...defaultDeps };

export function _setCliDeps(overrides: Partial<CliDeps>): void {
	Object.assign(cliDeps, overrides);
}

export function _resetCliDeps(): void {
	Object.assign(cliDeps, defaultDeps);
}

/* ----------------------------- Usage banner ----------------------------- */
initBootstrap();
function usage(): void {
	log.header("gks");

	log.subheader("Usage");
	log.line("  gks <command> [options]");
	log.line("");

	log.subheader("Commands");
	log.list([
		"lists                 Save GitHub lists to EXPORTS_DIR (./exports)",
		"repos                 Fetch repos from a given list (--list <name> [--json])",
		"stars                 Save starred repos to EXPORTS_DIR (./exports)",
		"unlisted              Save unlisted repos to EXPORTS_DIR (./exports)",
		"score                 Score repositories",
		"summarise             Summarise repositories",
		"ingest                Read repos from EXPORTS_DIR (./exports)",
		"topics:enrich         Enrich repos with topic metadata [--active] [--ttl <days>]",
		"setup                 Generate prompts.yaml from your GitHub lists",
	]);
	log.line("");

	log.subheader("Options for score");
	log.list([
		"--one <owner/repo>    Score a single repo",
		"--all [--limit N]     Score all repos (optionally limited)",
		"--dry                 Dry run without saving",
		"--curation-threshold N  Override removal threshold (default 0.1)",
	]);
	log.line("");

	log.subheader("Options for summarise");
	log.list([
		"--one <owner/repo>    Summarise a single repo",
		"--all [--limit N]     Summarise all repos (optionally limited)",
		"--dry                 Dry run without saving",
	]);
	log.line("");

	log.subheader("Examples");
	log.list([
		"gks score --one theGeekist/stars --dry",
		"gks score --all --limit 50",
		"gks summarise --all --dry",
	]);
	log.line("");

	log.subheader("Notes");
	log.list([
		"Default mode is --all",
		"Applies changes by default; pass --dry to preview only",
		"Manual curation is always preserved; adjust removal threshold via --curation-threshold",
	]);
	log.line("");
}

/* -------------------------- Command handlers --------------------------- */

async function handleLists(args: string[]): Promise<void> {
	let json = false;
	let out: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--json") json = true;
		else if (a === "--out" && args[i + 1]) {
			i += 1;
			out = args[i];
		}
	}
	const dir = Bun.env.EXPORTS_DIR ?? "./exports";
	if (json || out) await cliDeps.runLists(json, out, dir, log);
	else await cliDeps.runLists(false, undefined, dir, log);
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
	await cliDeps.runRepos(list, json, log);
}

async function handleStars(args: string[]): Promise<void> {
	let json = false;
	let out: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--json") json = true;
		else if (a === "--out" && args[i + 1]) {
			i += 1;
			out = args[i];
		}
	}
	const dir = Bun.env.EXPORTS_DIR ?? "./exports";
	if (json || out) await cliDeps.runStars(json, out, dir, log);
	else await cliDeps.runStars(false, undefined, dir, log);
}

async function handleUnlisted(args: string[]): Promise<void> {
	let json = false;
	let out: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const a = args[i];
		if (a === "--json") json = true;
		else if (a === "--out" && args[i + 1]) {
			i += 1;
			out = args[i];
		}
	}
	const dir = Bun.env.EXPORTS_DIR ?? "./exports";
	if (json || out) await cliDeps.runUnlisted(json, out, dir, undefined, log);
	else await cliDeps.runUnlisted(false, undefined, dir, undefined, log);
}

async function handleScore(argv: string[], args: string[]): Promise<void> {
	ensurePromptsReadyOrExit();
	const s = parseSimpleArgs(argv);
	let resume: number | "last" | undefined;
	let _notes: string | undefined;
	let fresh = false;
	let dry = s.dry;
	let curationThreshold: number | undefined;

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
		if (a === "--fresh" || a === "--from-scratch") {
			fresh = true;
			continue;
		}
		if (a === "--dry") dry = true;
		if (a === "--curation-threshold" && args[i + 1]) {
			i += 1;
			curationThreshold = Number(args[i]);
		}
	}

	// Build policy (respect curation by default)
	const policyBase = { ...DEFAULT_POLICY };
	if (curationThreshold != null && Number.isFinite(curationThreshold)) {
		policyBase.curationRemoveThreshold = curationThreshold;
	}

	if (s.mode === "one") {
		if (!s.one) {
			log.error("--one requires a value");
			process.exit(1);
		}
		await cliDeps.rankOne({ selector: s.one, dry, policy: policyBase });
	} else {
		const limit = Math.max(1, s.limit ?? 999999999);
		log.info(
			`Score --all limit=${limit} dry=${dry}${resume ? ` resume=${resume}` : ""}${fresh ? " fresh=true" : ""}${curationThreshold != null ? ` curationThreshold=${curationThreshold}` : ""}`,
		);
		await cliDeps.rankAll({ limit, dry, policy: policyBase });
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
	if (s.mode === "one") {
		if (!s.one) {
			log.error("--one requires a value");
			process.exit(1);
		}
		await cliDeps.summariseRepo({ selector: s.one, dry, logger: log });
	} else {
		const limit = Math.max(1, s.limit ?? 999999999);
		log.info(
			`Summarise --all limit=${limit} dry=${dry}${resummarise ? " resummarise=true" : ""}`,
		);
		await cliDeps.summariseAll({ limit, dry, resummarise, logger: log });
	}
}

async function handleIngest(_args: string[]): Promise<void> {
	const dir = Bun.env.EXPORTS_DIR ?? "./exports";
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

// topics:report command removed

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

		// topics:report removed

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
