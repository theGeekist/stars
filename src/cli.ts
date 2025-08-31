#!/usr/bin/env bun
/**
 * @geekist/stars CLI
 *
 * Commands:
 *   geek-stars lists [--json] [--out <file>]
 *   geek-stars repos --list <name> [--json]
 *   geek-stars dump [--out <file>]        (alias of: lists --json > file)
 *   geek-stars help
 *
 * Env:
 *   GITHUB_TOKEN  (Bun auto-loads .env)
 */

import { writeFileSync } from "node:fs";
import type { StarList, RepoLite } from "./lib/lists.js";
import { getAllLists, getReposFromList } from "./lib/lists.js";

type Command = "lists" | "repos" | "dump" | "help";

interface Parsed {
  command: Command;
  json: boolean;
  out?: string;
  list?: string;
  help: boolean;
}

const USAGE = `geek-stars

Usage:
  geek-stars lists [--json] [--out <file>]
  geek-stars repos --list <name> [--json]
  geek-stars dump [--out <file>]
  geek-stars help

Examples:
  geek-stars lists --json
  geek-stars dump --out lists.json
  geek-stars repos --list "AI" --json
`;

function parseArgs(argv: string[]): Parsed {
  const args = argv.slice(2);
  let command: Command = "help";
  let json = false;
  let out: string | undefined;
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

  return { command, json, out, list, help };
}

function ensureToken(): string {
  const token = Bun.env.GITHUB_TOKEN;
  if (!token) {
    console.error("❌ GITHUB_TOKEN missing. Add it to .env (Bun loads it automatically).");
    process.exit(1);
  }
  return token;
}

function printListsHuman(lists: StarList[]) {
  for (const l of lists) {
    const vis = l.isPrivate ? "private" : "public";
    console.log(`• ${l.name} [${vis}]`);
    if (l.description) console.log(`  ${l.description}`);
    console.log(`  items: ${l.repos.length}`);
  }
}

function printReposHuman(repos: RepoLite[]) {
  for (const r of repos) {
    console.log(`${r.nameWithOwner} (${r.stars}) ${r.url}`);
  }
}

async function runLists(json: boolean, out?: string) {
  const token = ensureToken();
  const lists = await getAllLists(token);

  if (out) {
    writeFileSync(out, JSON.stringify(lists, null, 2));
    console.log(`✔ Wrote ${lists.length} lists → ${out}`);
    return;
  }
  if (json) {
    console.log(JSON.stringify(lists, null, 2));
  } else {
    printListsHuman(lists);
  }
}

async function runRepos(listName: string, json: boolean) {
  const token = ensureToken();
  if (!listName) {
    console.error("❌ --list <name> is required for 'repos'.");
    process.exit(1);
  }
  const repos = await getReposFromList(token, listName);
  if (json) {
    console.log(JSON.stringify(repos, null, 2));
  } else {
    printReposHuman(repos);
  }
}

async function main() {
  const parsed = parseArgs(Bun.argv);

  if (parsed.help || parsed.command === "help") {
    console.log(USAGE);
    return;
  }

  switch (parsed.command) {
    case "lists":
      await runLists(parsed.json, parsed.out);
      return;
    case "dump":
      // Equivalent to: lists --json > file (but we handle writing for convenience)
      await runLists(true, parsed.out ?? "lists.json");
      return;
    case "repos":
      await runRepos(parsed.list ?? "", parsed.json);
      return;
    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  console.error("❌ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
