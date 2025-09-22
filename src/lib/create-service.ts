// Shared helper to standardise service factories across features

import type { Database } from "bun:sqlite";
import { withDB } from "@lib/db";
import { githubGraphQL } from "@lib/github";
import type { GhExec } from "@lib/types";

export type CreateServiceOpts = {
	/** Provide a specific DB (tests/multi-DB runners). Falls back to default via withDB. */
	db?: Database;
	/** Provide a GH executor (tests). Falls back to githubGraphQL. */
	exec?: GhExec;
	/** Token to use for GH calls (tests/CLIs). Falls back to env. */
	token?: string;
};

type FactoryDeps = {
	db: Database;
	exec: GhExec;
	token: string;
};

export function makeCreateService<TService>(
	factory: (deps: FactoryDeps) => TService,
) {
	return function createService(opts: CreateServiceOpts = {}): TService {
		const db = withDB(opts.db);
		const exec: GhExec = opts.exec ?? (githubGraphQL as GhExec);
		const token = opts.token ?? Bun.env.GITHUB_TOKEN ?? "";
		return factory({ db, exec, token });
	};
}
