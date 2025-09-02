#!/usr/bin/env bun
/**
 * @geekist/stars CLI
 *
 * Commands:
 *   geek-stars lists [--json] [--out <file>] [--dir <folder>]
 *   geek-stars repos --list <name> [--json]
 *   geek-stars dump [--out <file>] [--dir <folder>]   (alias of: lists)
 *   geek-stars help
 *
 * Env:
 *   GITHUB_TOKEN  (Bun auto-loads .env)
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "@lib/bootstrap";
import { getAllLists, getAllListsStream, getReposFromList } from "@lib/lists";
import type { RepoInfo, StarList } from "@lib/types";
import type { Command, Parsed } from "./types.js";

const USAGE = `geek-stars

Usage:
  geek-stars lists [--json] [--out <file>] [--dir <folder>]
  geek-stars repos --list <name> [--json]
  geek-stars dump [--out <file>] [--dir <folder>]
  geek-stars help

Examples:
  geek-stars lists --json
  geek-stars dump --out lists.json
  geek-stars lists --dir exports
  geek-stars repos --list "AI" --json
`;

function parseArgs(argv: string[]): Parsed {
	const args = argv.slice(2);
	let command: Command = "help";
	let json = false;
	let out: string | undefined;
	let dir: string | undefined;
	let list: string | undefined;
	let help = false;

	// First positional token is the command (if present)
	if (args[0] && !args[0].startsWith("-")) {
		const maybe = args[0] as Command;
		if (["lists", "repos", "dump", "help"].includes(maybe)) {
			command = maybe;
			args.shift();
		}
	}

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		switch (a) {
			case "--json":
				json = true;
				break;
			case "--out":
				out = args[++i];
				break;
			case "--dir":
				dir = args[++i];
				break;
			case "--list":
				list = args[++i];
				break;
			case "-h":
			case "--help":
				help = true;
				break;
			default:
				// Unknown flag or stray arg → show help, but don’t hard-fail
				help = true;
				break;
		}
	}

	return { command, json, out, dir, list, help };
}

export function ensureToken(): string {
	const token = Bun.env.GITHUB_TOKEN;
	if (!token) {
		log.error(
			"GITHUB_TOKEN missing. Add it to .env (Bun loads it automatically).",
		);
		process.exit(1);
	}
	return token;
}

export function printListsHuman(lists: StarList[]) {
	for (const l of lists) {
		const vis = l.isPrivate ? "private" : "public";
		log.info(`${l.name} [${vis}]`);
		if (l.description) log.line(`  ${l.description}`);
		log.line(`  items: ${l.repos.length}`);
	}
}

export function printReposHuman(repos: RepoInfo[]) {
	for (const r of repos) {
		log.line(`${r.nameWithOwner} (${r.stars}) ${r.url}`);
	}
}

function toSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/['"]/g, "") // drop quotes
		.replace(/[^a-z0-9]+/g, "-") // non-alnum -> hyphen
		.replace(/^-+|-+$/g, ""); // trim hyphens
}

export async function runLists(json: boolean, out?: string, dir?: string) {
	const token = ensureToken();

	// Stream to disk to avoid holding all lists in memory
	if (dir) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const index: Array<{
			listId: string;
			name: string;
			description: string | null;
			isPrivate: boolean;
			count: number;
			file: string;
		}> = [];

		let total = 0;
		for await (const l of getAllListsStream(token)) {
			const file = join(dir, `${toSlug(l.name) || "list"}.json`);
			writeFileSync(file, JSON.stringify(l, null, 2));
			log.success(`${l.name} → ${file}`);
			index.push({
				listId: l.listId,
				name: l.name,
				description: l.description ?? null,
				isPrivate: l.isPrivate,
				count: l.repos.length,
				file: `${toSlug(l.name) || "list"}.json`,
			});
			total++;
		}

		const indexFile = join(dir, "index.json");
		writeFileSync(indexFile, JSON.stringify(index, null, 2));
		log.success(`index → ${indexFile}`);
		log.success(`Wrote ${total} lists to ${dir}`);
		return;
	}

	// Non-dir paths keep original behavior for backwards compatibility
	const lists: StarList[] = await getAllLists(token);

	if (out) {
		writeFileSync(out, JSON.stringify(lists, null, 2));
		log.success(`Wrote ${lists.length} lists → ${out}`);
		return;
	}

	if (json) {
		log.json(lists);
	} else {
		printListsHuman(lists);
	}
}

export async function runRepos(listName: string, json: boolean) {
	const token = ensureToken();
	if (!listName) {
		log.error("--list <name> is required for 'repos'.");
		process.exit(1);
	}
	const repos: RepoInfo[] = await getReposFromList(token, listName);
	if (json) {
		log.json(repos);
	} else {
		printReposHuman(repos);
	}
}

async function main() {
	const parsed = parseArgs(Bun.argv);

	if (parsed.help || parsed.command === "help") {
		log.line(USAGE);
		return;
	}

	switch (parsed.command) {
		case "lists":
			await runLists(parsed.json, parsed.out, parsed.dir);
			return;

		case "dump":
			// Equivalent to: lists with output options
			await runLists(true, parsed.out ?? "lists.json", parsed.dir);
			return;

		case "repos":
			await runRepos(parsed.list ?? "", parsed.json);
			return;

		default:
			log.line(USAGE);
	}
}

main().catch((err) => {
	log.error("Error:", err instanceof Error ? err.message : err);
	process.exit(1);
});
