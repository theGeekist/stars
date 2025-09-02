// src/cli.ts
// Unified CLI entry with subcommands: lists, score, summarise, ingest, topics:enrich
import { log } from "@lib/bootstrap";
import { parseSimpleArgs, SIMPLE_USAGE } from "@lib/cli";
import { runLists, runRepos } from "@src/cli-lists";
import { scoreBatchAll, scoreOne } from "@src/cli-scorer";
import { summariseBatchAll, summariseOne } from "@src/cli-summarise";
import { ingestFromExports } from "@features/ingest/service";
import { enrichAllRepoTopics } from "@src/enrich-topics";

function usage(): void {
	log.line(`
gk-stars

Usage:
  gk-stars lists [--json] [--out <file>] [--dir <folder>]
  gk-stars repos --list <name> [--json]
  gk-stars score (--one <owner/repo> | --all [--limit N]) [--dry]
  gk-stars summarise (--one <owner/repo> | --all [--limit N]) [--dry]
  gk-stars ingest [--dir <folder>]    (defaults EXPORTS_DIR or ./exports)
  gk-stars topics:enrich [--active] [--ttl <days>]

Notes:
${SIMPLE_USAGE.trim()}
`);
}

async function main(argv: string[]) {
	const args = argv.slice(2);
	const cmd = args[0] ?? "help";

	switch (cmd) {
		case "help":
		case "--help":
		case "-h":
			usage();
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
			let list: string | undefined;
			let json = false;
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
			const s = parseSimpleArgs(argv);
			// Advanced flags
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
				if (a === "--dry") {
					dry = true;
				}
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
				await scoreBatchAll(limit, apply, undefined, { resume, notes, fresh });
			}
			return;
		}

		case "summarise":
		case "summarize": {
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
			return;
		}

		case "ingest": {
			const dirIdx = args.indexOf("--dir");
			const dir =
				dirIdx > -1 && args[dirIdx + 1]
					? args[dirIdx + 1]
					: (Bun.env.EXPORTS_DIR ?? "./exports");
			const res = await ingestFromExports(dir);
			log.success(`Ingested ${res.lists} lists from ${dir}`);
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
			await enrichAllRepoTopics({ onlyActive, ttlDays: ttl });
			return;
		}

		default:
			usage();
	}
}

if (import.meta.main)
	main(Bun.argv).catch((e) => {
		log.error(e instanceof Error ? e.message : String(e));
		process.exit(1);
	});
