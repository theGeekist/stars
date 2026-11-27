import type { Database, SQLQueryBindings } from "bun:sqlite";

type Row = Record<string, unknown>;

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

function parseJson(value: unknown, fallback: unknown = null): unknown {
	if (typeof value !== "string" || !value) return fallback;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return fallback;
	}
}

function rows(
	db: Database,
	sql: string,
	values: SQLQueryBindings[] = [],
): Row[] {
	return db.query(sql).all(...values) as Row[];
}

function hasColumn(db: Database, table: string, column: string): boolean {
	return (
		db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
	).some((item) => item.name === column);
}

function boundedText(
	value: unknown,
	maxBytes: number,
): { text: string; truncated: boolean } {
	const text = String(value ?? "");
	const bytes = Buffer.from(text);
	if (bytes.length <= maxBytes) return { text, truncated: false };
	let end = maxBytes;
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
	return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

function parseBoundedBody(
	value: unknown,
	enabled: boolean,
	maxBytes = 4096,
): Row {
	if (!enabled) return { bodyAvailable: value != null };
	const raw = typeof value === "string" ? value : JSON.stringify(value ?? null);
	const bounded = boundedText(raw, maxBytes);
	if (bounded.truncated)
		return {
			body: bounded.text,
			bodyTruncated: true,
			bodyBytes: Buffer.byteLength(raw),
		};
	return {
		body: parseJson(raw),
		bodyTruncated: false,
		bodyBytes: Buffer.byteLength(raw),
	};
}

function observationReference(value: unknown): Row {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const observation = value as Row;
	const reference: Row = {};
	for (const field of [
		"target",
		"target_key",
		"targetKey",
		"key",
		"revision",
		"role",
		"kind",
		"title",
	]) {
		const item = observation[field];
		if (typeof item === "string" && item.length <= 500) reference[field] = item;
	}
	if (Array.isArray(observation.context_topics)) {
		const contextTopics = observation.context_topics.filter(
			(item): item is string => typeof item === "string",
		);
		const boundedTopics = contextTopics
			.filter((topic) => Buffer.byteLength(topic) <= 256)
			.slice(0, 20);
		reference.context_topics = boundedTopics;
		if (boundedTopics.length < contextTopics.length)
			reference.context_topics_omitted =
				contextTopics.length - boundedTopics.length;
	}
	return reference;
}

function integerParam(
	params: URLSearchParams,
	name: string,
	defaultValue: number,
	min: number,
	max: number,
): number | null {
	if (!params.has(name)) return defaultValue;
	const raw = params.get(name) ?? "";
	if (!/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) && value >= min && value <= max
		? value
		: null;
}

function boolParam(params: URLSearchParams, name: string): boolean | null {
	if (!params.has(name)) return false;
	const value = params.get(name);
	return value === "true" ? true : value === "false" ? false : null;
}

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
	});
}

function tableExists(db: Database, name: string): boolean {
	return Boolean(
		db
			.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
			.get(name),
	);
}

function decodeRepo(row: Row, includeReadme = false): Row {
	const result = { ...row };
	for (const field of [
		"topics",
		"languages",
		"tags",
		"updates_json",
	] as const) {
		if (field in result)
			result[field] = parseJson(
				result[field],
				field === "topics" || field === "languages" || field === "tags"
					? []
					: null,
			);
	}
	if (!includeReadme) delete result.readme_md;
	else if (typeof result.readme_md === "string") {
		const bounded = boundedText(result.readme_md, 8_000);
		result.readme_md = bounded.text;
		if (bounded.truncated) result.readme_truncated = true;
	}
	return result;
}

function optionalResearchTables(db: Database) {
	return {
		targets: tableExists(db, "discovery_target"),
		edges: tableExists(db, "discovery_edge"),
		research: tableExists(db, "discovery_research"),
		provenance: tableExists(db, "recovery_provenance"),
	};
}

function handleOverview(db: Database): Response {
	const count = (sql: string) => {
		const result = db.query(sql).get() as { n?: number } | null;
		return Number(result?.n ?? 0);
	};
	const latestRun =
		rows(
			db,
			"SELECT id, created_at, notes FROM model_run ORDER BY id DESC LIMIT 1",
		)[0] ?? null;
	const topics = tableExists(db, "topics")
		? rows(
				db,
				`SELECT t.topic, t.display_name, COUNT(DISTINCT rt.repo_id) AS repositories
			 FROM topics t LEFT JOIN repo_topics rt ON rt.topic=t.topic
			 GROUP BY t.topic ORDER BY repositories DESC, t.topic LIMIT 100`,
			)
		: [];
	const discoveryTables = optionalResearchTables(db);
	return response({
		catalogue: {
			repositories: count("SELECT COUNT(*) AS n FROM repo"),
			lists: count("SELECT COUNT(*) AS n FROM list"),
			memberships: count("SELECT COUNT(*) AS n FROM list_repo"),
			listedRepositories: count(
				"SELECT COUNT(DISTINCT repo_id) AS n FROM list_repo",
			),
			unlistedRepositories: count(
				"SELECT COUNT(*) AS n FROM repo r WHERE NOT EXISTS (SELECT 1 FROM list_repo lr WHERE lr.repo_id=r.id)",
			),
		},
		coverage: {
			summaries: count(
				"SELECT COUNT(*) AS n FROM repo WHERE summary IS NOT NULL AND trim(summary)<>''",
			),
			readmes: count(
				"SELECT COUNT(*) AS n FROM repo WHERE readme_md IS NOT NULL AND trim(readme_md)<>''",
			),
			taggedRepositories: count(
				"SELECT COUNT(*) AS n FROM repo WHERE tags IS NOT NULL AND trim(tags)<>'[]'",
			),
			topicLinks: tableExists(db, "repo_topics")
				? count("SELECT COUNT(*) AS n FROM repo_topics")
				: 0,
			scoredRepositories: count(
				"SELECT COUNT(*) AS n FROM (SELECT repo_id FROM repo_list_score GROUP BY repo_id)",
			),
			latestScoreRun: latestRun,
		},
		latestScoreCoverage: latestRun
			? count(
					"SELECT COUNT(*) AS n FROM (SELECT repo_id FROM repo_list_score GROUP BY repo_id)",
				)
			: 0,
		topics,
		discovery: {
			available: discoveryTables.targets && discoveryTables.edges,
			targets: discoveryTables.targets
				? count("SELECT COUNT(*) AS n FROM discovery_target")
				: 0,
			currentSourceEdges: discoveryTables.edges
				? count("SELECT COUNT(*) AS n FROM discovery_edge")
				: 0,
			researchResults: discoveryTables.research
				? count("SELECT COUNT(*) AS n FROM discovery_research")
				: 0,
			provenanceSources: discoveryTables.provenance
				? count("SELECT COUNT(*) AS n FROM recovery_provenance")
				: 0,
		},
	});
}

function attachRelations(db: Database, repositories: Row[]): Row[] {
	if (!repositories.length) return repositories;
	const ids = repositories.map((repository) => Number(repository.id));
	const marks = ids.map(() => "?").join(",");
	const memberships = rows(
		db,
		`SELECT lr.repo_id, l.id AS list_id, l.slug, l.name, l.description
		 FROM list_repo lr JOIN list l ON l.id=lr.list_id
		 WHERE lr.repo_id IN (${marks}) ORDER BY l.name`,
		ids,
	);
	const scores = rows(
		db,
		`WITH latest AS (
			SELECT repo_id, MAX(run_id) AS run_id FROM repo_list_score
			WHERE repo_id IN (${marks}) GROUP BY repo_id
		)
		SELECT s.repo_id, s.list_slug, s.score, s.rationale, s.run_id
		FROM repo_list_score s JOIN latest l ON l.repo_id=s.repo_id AND l.run_id=s.run_id
		ORDER BY s.repo_id, s.score DESC, s.list_slug`,
		ids,
	);
	return repositories.map((repository) => {
		const id = Number(repository.id);
		return {
			...repository,
			memberships: memberships.filter((item) => Number(item.repo_id) === id),
			latestScores: scores
				.filter((item) => Number(item.repo_id) === id)
				.map(({ repo_id: _repoId, ...item }) => item),
		};
	});
}

function handleRepositorySearch(url: URL, db: Database): Response {
	const params = url.searchParams;
	const limit = integerParam(params, "limit", 20, 1, 100);
	const offset = integerParam(params, "offset", 0, 0, 1_000_000);
	const includeReadme = boolParam(params, "includeReadme");
	if (limit === null || offset === null || includeReadme === null)
		return response({ error: "Invalid pagination or boolean parameter" }, 400);
	const where = ["1=1"];
	const values: SQLQueryBindings[] = [];
	const q = params.get("q")?.trim();
	if (q && (q.length > 200 || hasControlCharacters(q)))
		return response(
			{ error: "q must be at most 200 printable characters" },
			400,
		);
	for (const name of ["list", "topic", "language"]) {
		const value = params.get(name);
		if (value && (value.length > 200 || hasControlCharacters(value)))
			return response(
				{ error: `${name} must be at most 200 printable characters` },
				400,
			);
	}
	if (q) {
		try {
			db.query("SELECT rowid FROM repo_fts WHERE repo_fts MATCH ? LIMIT 1").all(
				q,
			);
			where.push("r.id IN (SELECT rowid FROM repo_fts WHERE repo_fts MATCH ?)");
			values.push(q);
		} catch {
			where.push(
				"(r.name_with_owner LIKE '%' || ? || '%' OR r.description LIKE '%' || ? || '%' OR r.summary LIKE '%' || ? || '%')",
			);
			values.push(q, q, q);
		}
	}
	const list = params.get("list")?.trim();
	if (list) {
		where.push(
			"EXISTS (SELECT 1 FROM list_repo lr JOIN list l ON l.id=lr.list_id WHERE lr.repo_id=r.id AND l.slug=?)",
		);
		values.push(list);
	}
	const topic = params.get("topic")?.trim();
	if (topic) {
		where.push(
			"(EXISTS (SELECT 1 FROM repo_topics rt WHERE rt.repo_id=r.id AND lower(rt.topic)=lower(?)) OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(r.topics) THEN r.topics ELSE '[]' END) jt WHERE lower(jt.value)=lower(?)))",
		);
		values.push(topic, topic);
	}
	const language = params.get("language")?.trim();
	if (language) {
		where.push("lower(r.primary_language)=lower(?)");
		values.push(language);
	}
	const minStars = params.has("minStars")
		? Number(params.get("minStars"))
		: null;
	if (minStars !== null && (!Number.isSafeInteger(minStars) || minStars < 0))
		return response({ error: "minStars must be a non-negative integer" }, 400);
	if (minStars !== null) {
		where.push("COALESCE(r.stars,0)>=?");
		values.push(minStars);
	}
	for (const [param, column] of [
		["archived", "r.is_archived"],
		["fork", "r.is_fork"],
	] as const) {
		if (params.has(param)) {
			const enabled = boolParam(params, param);
			if (enabled === null)
				return response({ error: `${param} must be true or false` }, 400);
			where.push(`${column}=?`);
			values.push(enabled ? 1 : 0);
		}
	}
	for (const [param, column] of [
		["hasSummary", "r.summary"],
		["hasReadme", "r.readme_md"],
	] as const) {
		if (params.has(param)) {
			const enabled = boolParam(params, param);
			if (enabled === null)
				return response({ error: `${param} must be true or false` }, 400);
			where.push(
				enabled
					? `${column} IS NOT NULL AND trim(${column})<>''`
					: `(${column} IS NULL OR trim(${column})='')`,
			);
		}
	}
	const minScore = params.has("minScore")
		? Number(params.get("minScore"))
		: null;
	if (
		minScore !== null &&
		(!Number.isFinite(minScore) || minScore < 0 || minScore > 1)
	)
		return response({ error: "minScore must be between 0 and 1" }, 400);
	if (minScore !== null) {
		where.push(
			"EXISTS (SELECT 1 FROM repo_list_score s WHERE s.repo_id=r.id AND s.run_id=(SELECT MAX(s2.run_id) FROM repo_list_score s2 WHERE s2.repo_id=r.id) AND s.score>=?)",
		);
		values.push(minScore);
	}
	const sorts: Record<string, string> = {
		popularity: "COALESCE(r.popularity,0) DESC, COALESCE(r.stars,0) DESC",
		stars: "COALESCE(r.stars,0) DESC, r.name_with_owner COLLATE NOCASE",
		freshness: "COALESCE(r.freshness,0) DESC, r.name_with_owner COLLATE NOCASE",
		activeness:
			"COALESCE(r.activeness,0) DESC, r.name_with_owner COLLATE NOCASE",
		updated: "r.updated_at DESC, r.name_with_owner COLLATE NOCASE",
		name: "r.name_with_owner COLLATE NOCASE",
	};
	const sortName = params.get("sort") ?? "popularity";
	if (!Object.hasOwn(sorts, sortName))
		return response(
			{ error: `sort must be one of ${Object.keys(sorts).join(", ")}` },
			400,
		);
	const sort = `${sorts[sortName]}, r.name_with_owner, r.id`;
	const predicate = where.join(" AND ");
	const countResult = db
		.query(`SELECT COUNT(*) AS n FROM repo r WHERE ${predicate}`)
		.get(...values) as { n?: number } | null;
	const count = Number(countResult?.n ?? 0);
	let found = rows(
		db,
		`SELECT r.* FROM repo r WHERE ${predicate} ORDER BY ${sort} LIMIT ? OFFSET ?`,
		[...values, limit, offset],
	);
	found = found.map((row) => decodeRepo(row, includeReadme));
	return response({
		query: Object.fromEntries(params.entries()),
		page: {
			total: count,
			limit,
			offset,
			hasMore: offset + found.length < count,
		},
		repositories: attachRelations(db, found),
	});
}

function repositoryByKey(key: string, db: Database): Row | null {
	return (
		(db
			.query(
				`SELECT * FROM repo WHERE lower(name_with_owner)=lower(?) OR repo_id=? OR CAST(id AS TEXT)=? LIMIT 1`,
			)
			.get(key, key, key) as Row | null) ?? null
	);
}

function profileTopics(db: Database, repoId: number): Row[] {
	if (!tableExists(db, "repo_topics")) return [];
	const result = rows(
		db,
		`SELECT t.*, rt.added_at FROM repo_topics rt LEFT JOIN topics t ON t.topic=rt.topic WHERE rt.repo_id=? ORDER BY rt.topic`,
		[repoId],
	);
	return result.map((topic) => {
		const aliases = tableExists(db, "topic_alias")
			? rows(db, "SELECT alias FROM topic_alias WHERE topic=? ORDER BY alias", [
					String(topic.topic),
				])
			: [];
		const related = tableExists(db, "topic_related")
			? rows(db, "SELECT a,b FROM topic_related WHERE a=? OR b=?", [
					String(topic.topic),
					String(topic.topic),
				]).map((edge) => (edge.a === topic.topic ? edge.b : edge.a))
			: [];
		return { ...topic, aliases: aliases.map((item) => item.alias), related };
	});
}

function profileDiscovery(
	db: Database,
	repo: Row,
	includeEvidence: boolean,
): Row {
	const available = optionalResearchTables(db);
	let evidenceBudget = 24_000;
	const evidence = (value: unknown): Row => {
		const raw =
			typeof value === "string" ? value : JSON.stringify(value ?? null);
		const size = Buffer.byteLength(raw);
		if (!includeEvidence)
			return { bodyAvailable: value != null, bodyBytes: size };
		if (evidenceBudget <= 0)
			return {
				bodyAvailable: value != null,
				bodyOmitted: true,
				bodyBytes: size,
			};
		const result = parseBoundedBody(
			value,
			true,
			Math.min(4096, evidenceBudget),
		);
		evidenceBudget -= Math.min(size, 4096);
		return result;
	};
	const repoUrl = String(repo.url ?? "");
	const repoNodeId = String(repo.repo_id ?? "");
	const targetRows = available.targets
		? rows(
				db,
				`SELECT key,url,repo_node_id,status,error,result_json FROM discovery_target
				 WHERE (?<>'' AND repo_node_id=?)
				 OR (?<>'' AND (key=? OR substr(key,1,length(?)+10)=?||':resource:'))
				 OR lower(url)=lower(?) OR substr(lower(url),1,length(?)+1)=lower(?)||'/'
				 ORDER BY key LIMIT 25`,
				[
					repoNodeId,
					repoNodeId,
					repoNodeId,
					`github:${repoNodeId}`,
					`github:${repoNodeId}`,
					`github:${repoNodeId}`,
					repoUrl,
					repoUrl,
					repoUrl,
				],
			)
		: [];
	const targetKeys = new Set(targetRows.map((target) => String(target.key)));
	const includeContext =
		available.research &&
		hasColumn(db, "discovery_research", "source_context_json");
	const targets = targetRows.map((target) => {
		const { result_json: resultJson, ...metadata } = target;
		const edges = available.edges
			? rows(
					db,
					"SELECT source,observation_json FROM discovery_edge WHERE target_key=? ORDER BY source,observation_json LIMIT 5",
					[String(target.key)],
				).map((edge) => {
					const observation = parseJson(edge.observation_json, {});
					return {
						source: edge.source,
						...observationReference(observation),
						...evidence(observation),
					};
				})
			: [];
		const researchRows = available.research
			? rows(
					db,
					`SELECT id,completed_at,result_json${includeContext ? ",source_context_json" : ""}
					 FROM discovery_research WHERE target_key=? ORDER BY id DESC LIMIT 3`,
					[String(target.key)],
				)
			: [];
		const research = researchRows.map((item) => {
			const {
				result_json: result,
				source_context_json: sourceContext,
				...record
			} = item;
			const context = parseJson(sourceContext, []);
			const resultEvidence = evidence(result);
			const sourceContextEvidence =
				includeEvidence && includeContext ? evidence(sourceContext) : null;
			return {
				...record,
				...resultEvidence,
				sourceContextCount: Array.isArray(context) ? context.length : 0,
				sourceReferences: Array.isArray(context)
					? context.slice(0, 10).map((entry) => {
							const item = entry as Row;
							return {
								source: item.source,
								...observationReference(item.observation),
							};
						})
					: [],
				...(sourceContextEvidence
					? {
							sourceContext: sourceContextEvidence.body,
							sourceContextTruncated:
								sourceContextEvidence.bodyTruncated === true,
							sourceContextOmitted: sourceContextEvidence.bodyOmitted === true,
							sourceContextBytes: sourceContextEvidence.bodyBytes,
						}
					: {}),
			};
		});
		return {
			...metadata,
			resultBytes: Buffer.byteLength(String(resultJson ?? "")),
			...evidence(resultJson),
			edges,
			research,
		};
	});
	const provenance: Row[] = [];
	if (available.provenance) {
		for (const item of rows(
			db,
			"SELECT source,details_json FROM recovery_provenance ORDER BY source",
		)) {
			const details = parseJson(item.details_json, {}) as Row;
			const observations = Array.isArray(details.discovery_observations)
				? (details.discovery_observations as Row[])
						.filter((observation) => {
							const target = String(observation.target ?? "");
							const key = String(
								observation.target_key ??
									observation.targetKey ??
									observation.key ??
									"",
							);
							const repositoryKey = `github:${repoNodeId}`;
							if (
								key &&
								(targetKeys.has(key) ||
									key === repositoryKey ||
									key.startsWith(`${repositoryKey}:resource:`))
							)
								return true;
							if (targetKeys.has(target)) return true;
							if (
								target === repoUrl ||
								target === String(repo.name_with_owner ?? "") ||
								target === String(repo.repo_id ?? "")
							)
								return true;
							try {
								const root = new URL(repoUrl);
								const candidate = new URL(target);
								const base = root.pathname.replace(/\/$/, "");
								return (
									candidate.hostname.toLowerCase() ===
										root.hostname.toLowerCase() &&
									candidate.pathname
										.toLowerCase()
										.startsWith(`${base.toLowerCase()}/`)
								);
							} catch {
								return false;
							}
						})
						.slice(0, 20)
				: [];
			if (observations.length)
				provenance.push({
					source: item.source,
					observations: observations.map((observation) => ({
						...observationReference(observation),
						...evidence(observation),
					})),
				});
		}
	}
	return {
		available: available.targets || available.provenance,
		targetsAvailable: available.targets,
		targets,
		provenance,
	};
}

function handleRepositoryProfile(url: URL, db: Database): Response {
	let key = url.searchParams.get("key") ?? "";
	const params = url.searchParams;
	const includeReadme = boolParam(params, "includeReadme");
	const includeEvidence = boolParam(params, "includeEvidence");
	const historyLimit = integerParam(params, "historyLimit", 20, 1, 100);
	const historyOffset = integerParam(params, "historyOffset", 0, 0, 1_000_000);
	if (
		includeReadme === null ||
		includeEvidence === null ||
		historyLimit === null ||
		historyOffset === null
	)
		return response(
			{ error: "Invalid include flag or history pagination" },
			400,
		);
	const match = url.pathname.match(/^\/research\/repository\/(.+)$/);
	if (!key && match) key = decodeURIComponent(match[1]);
	if (!key.trim() || key.length > 300 || hasControlCharacters(key))
		return response(
			{ error: "Provide a valid key=<owner/repo|GitHub node ID|database ID>" },
			400,
		);
	const found = repositoryByKey(key.trim(), db);
	if (!found) return response({ error: "Repository not found", key }, 404);
	const id = Number(found.id);
	const historyTotal = Number(
		(
			db
				.query("SELECT COUNT(*) AS n FROM repo_list_score WHERE repo_id=?")
				.get(id) as { n: number }
		).n,
	);
	const history = rows(
		db,
		`SELECT s.run_id, mr.created_at AS run_created_at, mr.notes AS run_notes, s.list_slug, s.score, s.rationale
		 FROM repo_list_score s JOIN model_run mr ON mr.id=s.run_id WHERE s.repo_id=?
		 ORDER BY s.run_id DESC, s.score DESC, s.list_slug LIMIT ? OFFSET ?`,
		[id, historyLimit, historyOffset],
	);
	const override =
		rows(db, "SELECT * FROM repo_overrides WHERE repo_id=?", [id])[0] ?? null;
	if (override) {
		for (const field of ["install_steps_json", "display_topics_json"] as const)
			override[field] = parseJson(override[field], null);
	}
	const profile = attachRelations(db, [decodeRepo(found, includeReadme)])[0];
	return response({
		repository: profile,
		topics: profileTopics(db, id),
		scoreHistory: history,
		curatedOverride: override,
		discovery: profileDiscovery(db, found, includeEvidence),
		scoreHistoryPage: {
			total: historyTotal,
			limit: historyLimit,
			offset: historyOffset,
			hasMore: historyOffset + history.length < historyTotal,
		},
	});
}

function handleTopics(url: URL, db: Database): Response {
	if (!tableExists(db, "topics"))
		return response(
			{ error: "Topic enrichment tables are not initialized" },
			503,
		);
	const topic = url.searchParams.get("topic")?.trim();
	const limit = integerParam(url.searchParams, "limit", 50, 1, 100);
	const offset = integerParam(url.searchParams, "offset", 0, 0, 1_000_000);
	if (limit === null || offset === null)
		return response({ error: "Invalid topic pagination" }, 400);
	if (!topic) {
		const total = Number(
			(db.query("SELECT COUNT(*) AS n FROM topics").get() as { n: number }).n,
		);
		return response({
			topics: rows(
				db,
				`SELECT t.*, COUNT(DISTINCT rt.repo_id) AS repositories FROM topics t LEFT JOIN repo_topics rt ON rt.topic=t.topic GROUP BY t.topic ORDER BY repositories DESC, t.topic COLLATE NOCASE, t.topic LIMIT ? OFFSET ?`,
				[limit, offset],
			),
			page: { total, limit, offset, hasMore: offset + limit < total },
		});
	}
	if (topic.length > 200 || hasControlCharacters(topic))
		return response(
			{ error: "topic must be at most 200 printable characters" },
			400,
		);
	const canonical =
		(db
			.query(
				"SELECT * FROM topics WHERE lower(topic)=lower(?) OR lower(display_name)=lower(?)",
			)
			.get(topic, topic) as Row | null) ?? null;
	const alias =
		canonical ??
		(db
			.query(
				"SELECT t.* FROM topic_alias a JOIN topics t ON t.topic=a.topic WHERE lower(a.alias)=lower(?)",
			)
			.get(topic) as Row | null);
	if (!alias) return response({ error: "Topic not found", topic }, 404);
	const slug = String(alias.topic);
	const aliases = rows(
		db,
		"SELECT alias FROM topic_alias WHERE topic=? ORDER BY alias",
		[slug],
	);
	const related = rows(db, "SELECT a,b FROM topic_related WHERE a=? OR b=?", [
		slug,
		slug,
	]);
	const repositoryTotal = Number(
		(
			db
				.query("SELECT COUNT(*) AS n FROM repo_topics WHERE topic=?")
				.get(slug) as { n: number }
		).n,
	);
	const repositoryRows = rows(
		db,
		"SELECT r.* FROM repo_topics rt JOIN repo r ON r.id=rt.repo_id WHERE rt.topic=? ORDER BY COALESCE(r.popularity,0) DESC, r.name_with_owner COLLATE NOCASE, r.id LIMIT ? OFFSET ?",
		[slug, limit, offset],
	).map((row) => decodeRepo(row));
	return response({
		topic: alias,
		aliases: aliases.map((item) => item.alias),
		related: related.map((edge) => (edge.a === slug ? edge.b : edge.a)),
		repositories: attachRelations(db, repositoryRows),
		page: {
			total: repositoryTotal,
			limit,
			offset,
			hasMore: offset + repositoryRows.length < repositoryTotal,
		},
	});
}

function handleDiscoveries(url: URL, db: Database): Response {
	const available = optionalResearchTables(db);
	if (!available.targets)
		return response({ available: false, discoveries: [] });
	const params = url.searchParams;
	const limit = integerParam(params, "limit", 10, 1, 25);
	const offset = integerParam(params, "offset", 0, 0, 1_000_000);
	const includeEvidence = boolParam(params, "includeEvidence");
	if (limit === null || offset === null || includeEvidence === null)
		return response(
			{ error: "Invalid discovery pagination or includeEvidence flag" },
			400,
		);
	const where = ["1=1"];
	const values: SQLQueryBindings[] = [];
	for (const field of ["status", "repo_node_id"] as const) {
		const value = params.get(field)?.trim();
		if (value) {
			if (value.length > 200 || hasControlCharacters(value))
				return response(
					{ error: `${field} is too long or contains control characters` },
					400,
				);
			where.push(`t.${field}=?`);
			values.push(value);
		}
	}
	const source = params.get("source")?.trim();
	if (source && available.edges) {
		if (source.length > 200 || hasControlCharacters(source))
			return response(
				{ error: "source is too long or contains control characters" },
				400,
			);
		where.push(
			"EXISTS (SELECT 1 FROM discovery_edge e WHERE e.target_key=t.key AND e.source=?)",
		);
		values.push(source);
	}
	const predicate = where.join(" AND ");
	const countResult = db
		.query(`SELECT COUNT(*) AS n FROM discovery_target t WHERE ${predicate}`)
		.get(...values) as { n?: number } | null;
	const total = Number(countResult?.n ?? 0);
	const targets = rows(
		db,
		`SELECT t.* FROM discovery_target t WHERE ${predicate} ORDER BY t.key LIMIT ? OFFSET ?`,
		[...values, limit, offset],
	);
	let evidenceBudget = 24_000;
	const evidence = (value: unknown): Row => {
		const raw =
			typeof value === "string" ? value : JSON.stringify(value ?? null);
		const size = Buffer.byteLength(raw);
		if (!includeEvidence)
			return { bodyAvailable: value != null, bodyBytes: size };
		if (evidenceBudget <= 0)
			return {
				bodyAvailable: value != null,
				bodyOmitted: true,
				bodyBytes: size,
			};
		const result = parseBoundedBody(
			value,
			true,
			Math.min(4096, evidenceBudget),
		);
		evidenceBudget -= Math.min(size, 4096);
		return result;
	};
	const discoveries = targets.map((target) => {
		const { result_json: resultJson, ...metadata } = target;
		const edges = available.edges
			? rows(
					db,
					"SELECT source, observation_json FROM discovery_edge WHERE target_key=? ORDER BY source, observation_json LIMIT 5",
					[String(target.key)],
				).map((edge) => {
					const observation = parseJson(edge.observation_json, {});
					return {
						source: edge.source,
						...observationReference(observation),
						...evidence(observation),
					};
				})
			: [];
		const hasSourceContext =
			available.research &&
			hasColumn(db, "discovery_research", "source_context_json");
		const research = available.research
			? rows(
					db,
					`SELECT id,completed_at,result_json${hasSourceContext ? ",source_context_json" : ""} FROM discovery_research WHERE target_key=? ORDER BY id DESC LIMIT 3`,
					[String(target.key)],
				).map((item) => {
					const {
						result_json: result,
						source_context_json: sourceContext,
						...record
					} = item;
					const context = parseJson(sourceContext, []);
					const resultEvidence = evidence(result);
					const sourceContextEvidence =
						includeEvidence && hasSourceContext
							? evidence(sourceContext)
							: null;
					return {
						...record,
						...resultEvidence,
						sourceContextCount: Array.isArray(context) ? context.length : 0,
						sourceReferences: Array.isArray(context)
							? context.slice(0, 10).map((entry) => {
									const source = entry as Row;
									return {
										source: source.source,
										...observationReference(source.observation),
									};
								})
							: [],
						...(sourceContextEvidence
							? {
									sourceContext: sourceContextEvidence.body,
									sourceContextTruncated:
										sourceContextEvidence.bodyTruncated === true,
									sourceContextOmitted:
										sourceContextEvidence.bodyOmitted === true,
									sourceContextBytes: sourceContextEvidence.bodyBytes,
								}
							: {}),
					};
				})
			: [];
		return {
			...metadata,
			resultBytes: Buffer.byteLength(String(resultJson ?? "")),
			...evidence(resultJson),
			edges,
			research,
		};
	});
	return response({
		available: true,
		page: {
			total,
			limit,
			offset,
			hasMore: offset + discoveries.length < total,
		},
		discoveries,
	});
}

export function handleResearchApi(url: URL, db: Database): Response | null {
	if (url.pathname === "/research/overview")
		return db.transaction(() => handleOverview(db)).deferred();
	if (url.pathname === "/research/repositories")
		return db.transaction(() => handleRepositorySearch(url, db)).deferred();
	if (
		url.pathname === "/research/repository" ||
		url.pathname.startsWith("/research/repository/")
	)
		return db.transaction(() => handleRepositoryProfile(url, db)).deferred();
	if (url.pathname === "/research/topics")
		return db.transaction(() => handleTopics(url, db)).deferred();
	if (url.pathname === "/research/discoveries")
		return db.transaction(() => handleDiscoveries(url, db)).deferred();
	return null;
}
