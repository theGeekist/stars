// ./api/stars.ts
import type { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createStarsService } from "@features/stars";
import { log as realLog } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import type { ListsReporter } from "@lib/lists";
import { getAllLists, getAllListsStream, getReposFromList } from "@lib/lists";
import type { StarsReporter } from "@lib/stars";
import * as starsLib from "@lib/stars";
import { getAllStars, getAllStarsStream } from "@lib/stars";
import type { RepoInfo, StarList } from "@lib/types";
import { slugify } from "@lib/utils";

import type { StarListIndexItem, StarsIndexPageItem } from "./types";
import {
	ensureDirExists,
	getEnvStringRequired,
	listFilename as mkListFilename,
	pageFilename as mkPageFilename,
	printListsHuman,
	printReposHuman,
	writeJsonFile,
} from "./utils";

/* ----------------------------- Types & DI seams ----------------------------- */

type Logger = typeof realLog;

type StarsDeps = {
	// lists
	getAllLists: typeof getAllLists;
	getAllListsStream: typeof getAllListsStream;
	getReposFromList: typeof getReposFromList;
	// stars
	getAllStars: typeof getAllStars;
	getAllStarsStream: typeof getAllStarsStream;
	// feature service factory
	createStarsService: typeof createStarsService;
	// libs for service
	starsLib: typeof starsLib;
	// util
	slugify: typeof slugify;
};

const defaultDeps: StarsDeps = {
	getAllLists,
	getAllListsStream,
	getReposFromList,
	getAllStars,
	getAllStarsStream,
	createStarsService,
	starsLib,
	slugify,
};

/* -------------------------------- helpers -------------------------------- */

function ensureToken(logger: Logger): string {
	try {
		return getEnvStringRequired(
			"GITHUB_TOKEN",
			"GITHUB_TOKEN missing. Add it to .env (Bun loads it automatically).",
		);
	} catch (e) {
		logger.error((e as Error).message);
		process.exit(1);
	}
}

/* ----------------------------- lists commands ------------------------------ */

export async function runListsCore(
	json: boolean,
	out: string | undefined,
	dir: string | undefined,
	logger: Logger,
	deps: StarsDeps = defaultDeps,
): Promise<void> {
	const token = ensureToken(logger);
	const listsReporter: ListsReporter = { debug: (...a) => logger.debug(...a) };

	if (dir) {
		ensureDirExists(dir);

		const index: StarListIndexItem[] = [];
		let total = 0;

		const s = logger.spinner("Fetching lists...").start();
		try {
			for await (const l of deps.getAllListsStream(
				token,
				undefined,
				listsReporter,
			)) {
				total++;
				s.text = `Processed ${total} list${total === 1 ? "" : "s"}: ${l.name}`;

				const file = join(dir, mkListFilename(l.name, deps.slugify));
				writeFileSync(file, JSON.stringify(l, null, 2));

				index.push({
					listId: l.listId,
					name: l.name,
					description: l.description ?? null,
					isPrivate: l.isPrivate,
					count: l.repos.length,
					file: mkListFilename(l.name, deps.slugify),
				});
			}
			s.succeed(
				`Successfully processed ${total} list${total === 1 ? "" : "s"}`,
			);
		} catch (e) {
			s.fail("Failed while streaming lists");
			throw e;
		}

		await logger.withSpinner("Writing index.json", () => {
			const indexFile = join(dir, "index.json");
			writeJsonFile(indexFile, index);
		});

		logger.success(`Exported ${total} list${total === 1 ? "" : "s"} to ${dir}`);
		return;
	}

	const lists: StarList[] = await logger.withSpinner("Fetching lists", () =>
		deps.getAllLists(token, undefined, listsReporter),
	);

	if (out) {
		await logger.withSpinner(`Writing ${out}`, () => writeJsonFile(out, lists));
		logger.success(`Wrote ${lists.length} lists → ${out}`);
		return;
	}

	if (json) logger.json(lists);
	else printListsHuman(logger, lists);
}

export async function runReposCore(
	listName: string,
	json: boolean,
	logger: Logger,
	deps: StarsDeps = defaultDeps,
): Promise<void> {
	const token = ensureToken(logger);
	if (!listName) {
		logger.error("--list <name> is required");
		process.exit(1);
	}

	const listsReporter: ListsReporter = { debug: (...a) => logger.debug(...a) };

	const repos: RepoInfo[] = await logger.withSpinner(
		`Fetching repos for “${listName}”`,
		() => deps.getReposFromList(token, listName, undefined, listsReporter),
	);

	if (json) logger.json(repos);
	else printReposHuman(logger, repos);
}

/* ------------------------------ stars commands ----------------------------- */

export async function runStarsCore(
	json: boolean,
	out: string | undefined,
	dir: string | undefined,
	logger: Logger,
	deps: StarsDeps = defaultDeps,
): Promise<void> {
	const token = ensureToken(logger);
	const starsReporter: StarsReporter = { debug: (...a) => logger.debug(...a) };

	if (dir) {
		ensureDirExists(dir);

		const index: StarsIndexPageItem[] = [];
		let total = 0;
		let pageNo = 0;

		const s = logger.spinner("Fetching stars...").start();
		try {
			for await (const page of deps.getAllStarsStream(
				token,
				undefined,
				starsReporter,
			)) {
				pageNo++;
				const fileName = mkPageFilename("stars", pageNo);
				const file = join(dir, fileName);
				writeFileSync(file, JSON.stringify(page, null, 2));
				index.push({ file: fileName, count: page.length });
				total += page.length;
				s.text = `Processed page ${pageNo}: ${total} repositories total`;
			}
			s.succeed(`Successfully processed ${total} starred repositories`);
		} catch (e) {
			s.fail("Failed while streaming stars");
			throw e;
		}

		await logger.withSpinner("Writing index.json", () => {
			const indexFile = join(dir, "index.json");
			writeJsonFile(indexFile, { total, pages: index });
		});

		logger.success(`Exported ${total} starred repositories to ${dir}`);
		return;
	}

	const stars: RepoInfo[] = await logger.withSpinner("Fetching stars", () =>
		deps.getAllStars(token, undefined, starsReporter),
	);

	if (out) {
		await logger.withSpinner(`Writing ${out}`, () => writeJsonFile(out, stars));
		logger.success(`Exported ${stars.length} starred repositories → ${out}`);
		return;
	}

	if (json) logger.json(stars);
	else printReposHuman(logger, stars);
}

/* --------------------------- “unlisted stars” --------------------------- */

export async function runUnlistedCore(
	json: boolean,
	out: string | undefined,
	dir: string | undefined,
	database: Database | undefined,
	logger: Logger,
	deps: StarsDeps = defaultDeps,
): Promise<void> {
	ensureToken(logger);

	const s = logger.spinner("Computing unlisted stars...").start();
	const svc = deps.createStarsService(deps.starsLib, withDB(database));
	const unlisted = await svc.read.getUnlistedStars();
	s.succeed(`Found ${unlisted.length} unlisted starred repositories`);

	if (dir) {
		ensureDirExists(dir);
		const file = join(dir, "unlisted.json");
		await logger.withSpinner(`Writing ${file}`, () =>
			writeJsonFile(file, unlisted),
		);
		logger.success(`Wrote ${unlisted.length} entries → ${file}`);
		return;
	}

	if (out) {
		await logger.withSpinner(`Writing ${out}`, () =>
			writeJsonFile(out, unlisted),
		);
		logger.success(`Wrote ${unlisted.length} entries → ${out}`);
		return;
	}

	if (json) logger.json(unlisted);
	else printReposHuman(logger, unlisted);
}

/* ------------------------------ Public API ------------------------------ */

/** @deprecated Use fetchLists from stars.public */
export async function runLists(json: boolean, out?: string, dir?: string) {
	await runListsCore(json, out, dir, realLog);
}

/** @deprecated Use fetchReposFromList from stars.public */
export async function runRepos(listName: string, json: boolean) {
	await runReposCore(listName, json, realLog);
}

/** @deprecated Use fetchStars from stars.public */
export async function runStars(json: boolean, out?: string, dir?: string) {
	await runStarsCore(json, out, dir, realLog);
}

/** @deprecated Use fetchUnlistedStars from stars.public */
export async function runUnlisted(
	json: boolean,
	out?: string,
	dir?: string,
	database?: Database,
) {
	await runUnlistedCore(json, out, dir, database, realLog);
}
