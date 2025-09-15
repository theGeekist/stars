/**
 * Central typed dispatcher for invoking public API operations by a string key.
 *
 * Extension steps (add new operation):
 * 1. Add the new literal to DispatchKind.
 * 2. Create/augment an args interface if extra fields beyond existing option type are required.
 * 3. Add entry to DispatchArgsMap.
 * 4. Add corresponding switch case invoking the public function.
 *
 * This pattern keeps dynamic invocation free of `any` by mapping keys → concrete option shapes.
 */
import {
	type IngestOptions,
	ingestAll,
	ingestListsOnly,
	ingestUnlistedOnly,
} from "./ingest.public";
import {
	type RankAllOptions,
	type RankOneOptions,
	rankAll,
	rankOne,
} from "./ranking.public";
import {
	fetchLists,
	fetchReposFromList,
	fetchStars,
	fetchUnlistedStars,
	type StarsFetchOptions,
} from "./stars.public";
import {
	type SummariseAllOptions,
	type SummariseOneOptions,
	summariseAll,
	summariseRepo,
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
interface IngestListsArgs
	extends Omit<Parameters<typeof ingestListsOnly>[0], never> {}
interface IngestUnlistedArgs
	extends Omit<Parameters<typeof ingestUnlistedOnly>[0], never> {}

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
	"ingest:lists": IngestListsArgs;
	"ingest:unlisted": IngestUnlistedArgs;
};

export type DispatchOptions<K extends DispatchKind> = {
	args: DispatchArgsMap[K];
};

/** Execute a public API function based on a dispatch kind + typed args. */
export async function dispatchCommand<K extends DispatchKind>(
	kind: K,
	options: DispatchOptions<K>,
): Promise<unknown> {
	const a = options.args as DispatchArgsMap[K];
	switch (kind) {
		case "summaries:all":
			return summariseAll(a as SummariseAllOptions);
		case "summaries:one":
			return summariseRepo(a as SummariseOneOptions);
		case "ranking:all":
			return rankAll(a as RankAllOptions);
		case "ranking:one":
			return rankOne(a as RankOneOptions);
		case "stars:lists":
			return fetchLists(a as StarsFetchOptions);
		case "stars:listRepos":
			return fetchReposFromList(
				(a as StarsListReposArgs).listName,
				a as StarsListReposArgs,
			);
		case "stars:stars":
			return fetchStars(a as StarsFetchOptions);
		case "stars:unlisted":
			return fetchUnlistedStars(
				(a as StarsUnlistedArgs).db,
				a as StarsUnlistedArgs,
			);
		case "ingest:all":
			return ingestAll(a as IngestOptions);
		case "ingest:lists":
			return ingestListsOnly(a as IngestListsArgs);
		case "ingest:unlisted":
			return ingestUnlistedOnly(a as IngestUnlistedArgs);
		default: {
			const _never: never = kind; // exhaustive
			return Promise.reject(new Error(`Unsupported dispatch kind: ${kind}`));
		}
	}
}
