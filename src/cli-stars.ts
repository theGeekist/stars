import type { Database } from "bun:sqlite";
// src/cli-stars.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createStarsService } from "@features/stars"; // feature layer provides getUnlistedStars()
import { log } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import type { ListsReporter } from "@lib/lists";
import { getAllLists, getAllListsStream, getReposFromList } from "@lib/lists";
import type { StarsReporter } from "@lib/stars";
import { getAllStars, getAllStarsStream } from "@lib/stars";
import type { RepoInfo, StarList } from "@lib/types";
import { slugify } from "@lib/utils";

/* ------------------------------- reporters ------------------------------ */

const listsReporter: ListsReporter = { debug: (...a) => log.debug(...a) };
const starsReporter: StarsReporter = { debug: (...a) => log.debug(...a) };

/* -------------------------------- helpers ------------------------------- */

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

function listFilename(name: string): string {
	const base = slugify(name) || "list";
	return `${base}.json`;
}

function pageFilename(prefix: string, n: number): string {
	return `${prefix}-page-${String(n).padStart(3, "0")}.json`;
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

/* ----------------------------- lists commands --------------------------- */

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
			for await (const l of getAllListsStream(
				token,
				undefined,
				listsReporter,
			)) {
				total++;
				s.text = `Writing list ${total}: ${l.name}`;
				const file = join(dir, listFilename(l.name));
				writeFileSync(file, JSON.stringify(l, null, 2));
				index.push({
					listId: l.listId,
					name: l.name,
					description: l.description ?? null,
					isPrivate: l.isPrivate,
					count: l.repos.length,
					file: listFilename(l.name),
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
		getAllLists(token, undefined, listsReporter),
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
		() => getReposFromList(token, listName, undefined, listsReporter),
	);

	if (json) {
		log.json(repos);
	} else {
		printReposHuman(repos);
	}
}

/* ----------------------------- stars commands --------------------------- */

/**
 * Dump all stars. If `dir` is provided, stream page by page to disk:
 *   - stars-page-001.json, stars-page-002.json, ...
 *   - index.json (summary)
 * Otherwise: emit one JSON blob to stdout or to `out`.
 */
export async function runStars(json: boolean, out?: string, dir?: string) {
	const token = ensureToken();

	if (dir) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const index: Array<{ file: string; count: number }> = [];
		let total = 0;
		let pageNo = 0;

		const s = log.spinner("Fetching stars...").start();
		try {
			for await (const page of getAllStarsStream(
				token,
				undefined,
				starsReporter,
			)) {
				pageNo++;
				const file = join(dir, pageFilename("stars", pageNo));
				writeFileSync(file, JSON.stringify(page, null, 2));
				index.push({ file: pageFilename("stars", pageNo), count: page.length });
				total += page.length;
				s.text = `Wrote ${page.length} repos to ${pageFilename("stars", pageNo)}`;
			}
			s.succeed(`Fetched ${total} starred repositories`);
		} catch (e) {
			s.fail("Failed while streaming stars");
			throw e;
		}

		await log.withSpinner("Writing index.json", () => {
			const indexFile = join(dir, "index.json");
			writeFileSync(
				indexFile,
				JSON.stringify({ total, pages: index }, null, 2),
			);
		});

		log.success(`Wrote ${total} stars to ${dir}`);
		return;
	}

	// Non-dir path: fetch all at once
	const stars: RepoInfo[] = await log.withSpinner("Fetching stars", () =>
		getAllStars(token, undefined, starsReporter),
	);

	if (out) {
		await log.withSpinner(`Writing ${out}`, () =>
			writeFileSync(out, JSON.stringify(stars, null, 2)),
		);
		log.success(`Wrote ${stars.length} stars → ${out}`);
		return;
	}

	if (json) {
		log.json(stars);
	} else {
		printReposHuman(stars);
	}
}

/**
 * Compute “unlisted stars” = (all stars) \ (repos in any list).
 * Uses the feature layer to keep lib modules pure.
 */
export async function runUnlisted(
	json: boolean,
	out?: string,
	dir?: string,
	database?: Database,
) {
	ensureToken();
	const s = log.spinner("Computing unlisted stars...").start();

	const svc = createStarsService(withDB(database));
	const unlisted = await svc.read.getUnlistedStars();

	s.succeed(`Found ${unlisted.length} unlisted starred repositories`);

	// NEW: directory mode – write to <dir>/unlisted.json
	if (dir) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const file = join(dir, "unlisted.json");
		await log.withSpinner(`Writing ${file}`, () =>
			writeFileSync(file, JSON.stringify(unlisted, null, 2)),
		);
		log.success(`Wrote ${unlisted.length} entries → ${file}`);
		return;
	}

	if (out) {
		await log.withSpinner(`Writing ${out}`, () =>
			writeFileSync(out, JSON.stringify(unlisted, null, 2)),
		);
		log.success(`Wrote ${unlisted.length} entries → ${out}`);
		return;
	}

	if (json) {
		log.json(unlisted);
	} else {
		printReposHuman(unlisted);
	}
}
