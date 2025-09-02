// src/cli-lists.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "@lib/bootstrap";
import type { ListsReporter } from "@lib/lists";
import { getAllLists, getAllListsStream, getReposFromList } from "@lib/lists";
import type { RepoInfo, StarList } from "@lib/types";

const reporter: ListsReporter = { debug: (...a) => log.debug(...a) };
/* ------------------------------- helpers ------------------------------- */

function ensureToken(): string {
	const token = Bun.env.GITHUB_TOKEN;
	if (!token) {
		log.error(
			"GITHUB_TOKEN missing. Add it to .env (Bun loads it automatically).",
		);
		process.exit(1);
	}
	return token;
}

function toSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/['"]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function printListsHuman(lists: StarList[]) {
	log.header("Lists");
	log.columns(
		lists.map((l) => ({
			Name: l.name,
			Vis: l.isPrivate ? "private" : "public",
			Items: String(l.repos.length),
			Description: l.description ?? "",
		})),
		["Name", "Vis", "Items", "Description"],
	);
}

function printReposHuman(repos: RepoInfo[]) {
	log.header("Repositories");
	log.columns(
		repos.map((r) => ({
			Repository: r.nameWithOwner,
			"★": String(r.stars ?? ""),
			URL: r.url,
		})),
		["Repository", "★", "URL"],
	);
}

/* --------------------------------- API --------------------------------- */

export async function runLists(json: boolean, out?: string, dir?: string) {
	const token = ensureToken();

	// Stream to a directory (progress + index.json)
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
		const s = log.spinner("Fetching lists...").start();
		try {
			for await (const l of getAllListsStream(token, undefined, reporter)) {
				total++;
				s.text = `Writing list ${total}: ${l.name}`;
				const file = join(dir, `${toSlug(l.name) || "list"}.json`);
				writeFileSync(file, JSON.stringify(l, null, 2));
				index.push({
					listId: l.listId,
					name: l.name,
					description: l.description ?? null,
					isPrivate: l.isPrivate,
					count: l.repos.length,
					file: `${toSlug(l.name) || "list"}.json`,
				});
			}
			s.succeed(`Fetched ${total} lists`);
		} catch (e) {
			s.fail("Failed while streaming lists");
			throw e;
		}

		await log.withSpinner("Writing index.json", () => {
			const indexFile = join(dir, "index.json");
			writeFileSync(indexFile, JSON.stringify(index, null, 2));
		});

		log.success(`Wrote ${total} lists to ${dir}`);
		return;
	}

	// Non-dir path: fetch all at once
	const lists: StarList[] = await log.withSpinner("Fetching lists", () =>
		getAllLists(token, undefined, reporter),
	);

	if (out) {
		await log.withSpinner(`Writing ${out}`, () =>
			writeFileSync(out, JSON.stringify(lists, null, 2)),
		);
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
		log.error("--list <name> is required");
		process.exit(1);
	}

	const repos: RepoInfo[] = await log.withSpinner(
		`Fetching repos for “${listName}”`,
		() => getReposFromList(token, listName, undefined, reporter),
	);

	if (json) {
		log.json(repos);
	} else {
		printReposHuman(repos);
	}
}
