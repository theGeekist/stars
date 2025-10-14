/**
 * Central typed dispatcher for invoking public API operations by a string key.
 *
 * Extension steps (add new operation):
 * 1. Add the new literal to DispatchKind.
 * 2. Create/augment an args interface if extra fields beyond existing option type are required.
 * 3. Add entry to DispatchArgsMap.
 * 4. Register a handler in the `handlers` table below.
 *
 * This pattern keeps dynamic invocation free of `any` by mapping keys → concrete option shapes.
 */
import {
	ingestAll,
	ingestListsOnly,
	ingestUnlistedOnly,
	type IngestListsOptions,
	type IngestOptions,
	type IngestUnlistedOptions,
} from "./ingest.public";
import {
	rankAll,
	rankOne,
	type RankAllOptions,
	type RankOneOptions,
} from "./ranking.public";
import {
	fetchLists,
	fetchReposFromList,
	fetchStars,
	fetchUnlistedStars,
	type StarsFetchOptions,
} from "./stars.public";
import {
	summariseAll,
	summariseRepo,
	type SummariseAllOptions,
	type SummariseOneOptions,
} from "./summarise.public";

/** Enumerates all string keys accepted by the dispatcher. */
export type DispatchKind =
	| "summaries:all"
	| "summaries:one"
	| "ranking:all"
	| "ranking:one"
	| "stars:lists"
	| "stars:listRepos"
	| "stars:stars"
	| "stars:unlisted"
	| "ingest:all"
	| "ingest:lists"
	| "ingest:unlisted";

/** Mapped argument types for each dispatch key. */
interface StarsListReposArgs extends StarsFetchOptions {
	listName: string;
}
interface StarsUnlistedArgs extends StarsFetchOptions {
	db?: Parameters<typeof fetchUnlistedStars>[0];
}

type DispatchArgsMap = {
	"summaries:all": SummariseAllOptions;
	"summaries:one": SummariseOneOptions;
	"ranking:all": RankAllOptions;
	"ranking:one": RankOneOptions;
	"stars:lists": StarsFetchOptions;
	"stars:listRepos": StarsListReposArgs;
	"stars:stars": StarsFetchOptions;
	"stars:unlisted": StarsUnlistedArgs;
	"ingest:all": IngestOptions;
	"ingest:lists": IngestListsOptions;
	"ingest:unlisted": IngestUnlistedOptions;
};

export type DispatchOptions<K extends DispatchKind> = {
	args: DispatchArgsMap[K];
};

type HandlerMap = {
	[K in DispatchKind]: (args: DispatchArgsMap[K]) => Promise<unknown>;
};

const handlers: HandlerMap = {
	"summaries:all": (args) => summariseAll(args),
	"summaries:one": (args) => summariseRepo(args),
	"ranking:all": (args) => rankAll(args),
	"ranking:one": (args) => rankOne(args),
	"stars:lists": (args) => fetchLists(args),
	"stars:listRepos": (args) => fetchReposFromList(args.listName, args),
	"stars:stars": (args) => fetchStars(args),
	"stars:unlisted": (args) => fetchUnlistedStars(args.db, args),
	"ingest:all": (args) => ingestAll(args),
	"ingest:lists": (args) => ingestListsOnly(args),
	"ingest:unlisted": (args) => ingestUnlistedOnly(args),
};

/** Execute a public API function based on a dispatch kind + typed args. */
export async function dispatchCommand<K extends DispatchKind>(
	kind: K,
	options: DispatchOptions<K>,
): Promise<unknown> {
	const handler = handlers[kind];
	return handler(options.args);
}
