// src/features/lists/api.ts

import { makeCreateService } from "@lib/create-service";
import type { StarList } from "@lib/types";
import * as ops from "./ops";
import { prepareStatements } from "./statements";
import type { ListsService } from "./types";

export const createListsService = makeCreateService<ListsService>(
	({ db, exec, token }) => {
		const stmts = prepareStatements(db);
		const pageSize = 25;
		return {
			read: {
				// stream-first; callers can materialise locally if they need arrays
				getAll: async () => {
					const lists: StarList[] = [];
					for await (const list of ops.getAllListsStream(
						token,
						pageSize,
						exec,
					)) {
						lists.push(list);
					}
					return lists;
				},
				getAllStream: () => ops.getAllListsStream(token, pageSize, exec),
				getReposFromList: (listName: string, pageSize: number) =>
					ops.getReposFromList(token, listName, pageSize, exec),
				getListDefs: async () => stmts.qListDefs.all(),
				getReposToScore: (sel) => ops.getReposToScore(stmts, sel),
				currentMembership: (repoId) => ops.currentMembership(stmts, repoId),
				mapSlugsToGhIds: (slugs) => ops.mapSlugsToGhIds(stmts, slugs),
				getUnlistedStars: () => ops.getUnlistedStars(stmts, token),
			},
			apply: {
				reconcileLocal: (repoId, slugs) =>
					ops.reconcileLocal(stmts, repoId, slugs),
				updateOnGitHub: (t, repoGlobalId, listIds) =>
					ops.updateOnGitHub(t, repoGlobalId, listIds, exec),
				ensureListGhIds: () => ops.ensureListGhIds(stmts),
				ensureRepoGhId: (repoId) => ops.ensureRepoGhId(stmts, repoId), // ← no token
			},
		};
	},
);
