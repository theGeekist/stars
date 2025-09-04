// test-utils/github-fakes.ts
type Vars = Record<string, unknown>;
type Handler = (vars?: Vars) => unknown;
type Page = Record<string, Handler>;

export type GhClient = <T>(
	token: string,
	query: string,
	vars?: Vars,
) => Promise<T>;

export interface Options {
	/**
	 * Advance page trigger (default: the "primary" key matched on a page).
	 * - string: advance when the *normalised full query* includes this needle.
	 * - fn: decide using the matched handler key, normalised query, and vars.
	 */
	paginateOn?:
		| string
		| ((matchedKey: string, q: string, vars?: Vars) => boolean);
	/** Normaliser for query & keys. Default collapses whitespace. */
	normalise?: (s: string) => string;
	/** Terse errors vs verbose preview of the query. Default: verbose. */
	verboseErrors?: boolean;
	/** Safety fuse for paged mode: throw if we advance > this many pages. */
	maxPages?: number;
}

const defaultNorm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Build a fake GitHub GraphQL client.
 *  - Single-map mode: `makeFakeGh({ QUERY: (vars) => data })`
 *  - Paged mode: `makeFakeGh([ { QUERY: ... }, { QUERY: ... } ], { paginateOn: '...' })`
 */
export function makeFakeGh(handlers: Page, opts?: Options): GhClient;
export function makeFakeGh(seq: Page[], opts?: Options): GhClient;
export function makeFakeGh(
	handlersOrSeq: Page | Page[],
	opts: Options = {},
): GhClient {
	const norm = opts.normalise ?? defaultNorm;
	const verbose = opts.verboseErrors !== false;

	const buildTable = (rec: Page) => {
		const table = new Map<string, Handler>();
		for (const [k, v] of Object.entries(rec)) table.set(norm(k), v);
		return table;
	};

	// --- Single-map fast path -------------------------------------------------
	if (!Array.isArray(handlersOrSeq)) {
		const table = buildTable(handlersOrSeq);
		return async function fake<T>(
			_token: string,
			query: string,
			vars?: Vars,
		): Promise<T> {
			const q = norm(query);
			const entry =
				[...table.entries()].find(([k]) => k === q) ??
				[...table.entries()].find(([k]) => q.includes(k));
			if (!entry) {
				const msg = verbose
					? `No fake handler for query:\n\n${query.slice(0, 200)}...`
					: "no handler for query";
				throw new Error(msg);
			}
			const [, fn] = entry;
			return fn(vars) as T;
		};
	}

	// --- Paged sequence -------------------------------------------------------
	const seq = handlersOrSeq;
	let pageIndex = 0;
	const maxPages = opts.maxPages ?? seq.length + 8; // permissive fuse

	return async function fake<T>(
		_token: string,
		query: string,
		vars?: Vars,
	): Promise<T> {
		const idx = Math.min(pageIndex, seq.length - 1);
		const rec = seq[idx];
		const table = buildTable(rec);
		const q = norm(query);

		const entry =
			[...table.entries()].find(([k]) => k === q) ??
			[...table.entries()].find(([k]) => q.includes(k));

		if (!entry) {
			const msg = verbose
				? `No fake handler for query (page ${idx}):\n\n${query.slice(0, 200)}...`
				: "no handler for query";
			throw new Error(msg);
		}

		const [matchedKey, fn] = entry;
		const out = fn(vars) as T;

		// Decide whether to advance page
		let advance = false;
		if (typeof opts.paginateOn === "function") {
			advance = opts.paginateOn(matchedKey, q, vars);
		} else if (typeof opts.paginateOn === "string") {
			advance = q.includes(norm(opts.paginateOn));
		} else {
			// Default heuristic: advance when we matched this page's "primary" key
			const firstKey = norm(Object.keys(rec)[0] ?? "");
			advance = matchedKey === firstKey;
		}

		if (advance && pageIndex < seq.length - 1) {
			pageIndex++;
			if (pageIndex > maxPages)
				throw new Error("makeFakeGh: exceeded maxPages (safety fuse)");
		}

		return out as T;
	};
}
