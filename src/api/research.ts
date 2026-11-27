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
				"SELECT COUNT(DISTINCT repo_id) AS n FROM repo_list_score",
			),
			latestScoreRun: latestRun,
		},
		latestScoreCoverage: latestRun
			? count(
					`SELECT COUNT(DISTINCT repo_id) AS n FROM repo_list_score WHERE run_id=${Number(latestRun.id)}`,
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
	const latestRun =
		Number(rows(db, "SELECT MAX(id) AS id FROM model_run")[0]?.id ?? 0) || null;
	const scores = latestRun
		? rows(
				db,
				`SELECT s.repo_id, s.list_slug, s.score, s.rationale, s.run_id
			 FROM repo_list_score s WHERE s.run_id=? AND s.repo_id IN (${marks})
			 ORDER BY s.score DESC, s.list_slug`,
				[latestRun, ...ids],
			)
		: [];
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
	const limit = Math.max(1, Math.min(100, Number(params.get("limit")) || 20));
	const offset = Math.max(0, Number(params.get("offset")) || 0);
	const includeReadme = params.get("includeReadme") === "true";
	const where = ["1=1"];
	const values: SQLQueryBindings[] = [];
	const q = params.get("q")?.trim();
	if (q) {
		try {
			db.query("SELECT rowid FROM repo_fts WHERE repo_fts MATCH ? LIMIT 0").all(
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
	const minStars = Number(params.get("minStars"));
	if (Number.isFinite(minStars) && params.has("minStars")) {
		where.push("COALESCE(r.stars,0)>=?");
		values.push(minStars);
	}
	for (const [param, column] of [
		["archived", "r.is_archived"],
		["fork", "r.is_fork"],
	] as const) {
		if (params.has(param)) {
			where.push(`${column}=?`);
			values.push(params.get(param) === "true" ? 1 : 0);
		}
	}
	for (const [param, column] of [
		["hasSummary", "r.summary"],
		["hasReadme", "r.readme_md"],
	] as const) {
		if (params.has(param)) {
			where.push(
				params.get(param) === "true"
					? `${column} IS NOT NULL AND trim(${column})<>''`
					: `(${column} IS NULL OR trim(${column})='')`,
			);
		}
	}
	const minScore = Number(params.get("minScore"));
	if (Number.isFinite(minScore) && params.has("minScore")) {
		where.push(
			"EXISTS (SELECT 1 FROM repo_list_score s WHERE s.repo_id=r.id AND s.run_id=(SELECT MAX(id) FROM model_run) AND s.score>=?)",
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
	const sort = sorts[params.get("sort") ?? "popularity"] ?? sorts.popularity;
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

function profileDiscovery(db: Database, repo: Row): Row {
	const available = optionalResearchTables(db);
	if (!available.targets)
		return { available: false, targets: [], provenance: [] };
	const targets = rows(
		db,
		"SELECT * FROM discovery_target WHERE repo_node_id=? OR lower(url)=lower(?) ORDER BY key",
		[String(repo.repo_id ?? ""), String(repo.url ?? "")],
	).map((target) => {
		const edges = available.edges
			? rows(
					db,
					"SELECT source, observation_json FROM discovery_edge WHERE target_key=? ORDER BY source",
					[String(target.key)],
				).map((edge) => ({
					source: edge.source,
					observation: parseJson(edge.observation_json, {}),
				}))
			: [];
		const research = available.research
			? rows(
					db,
					"SELECT id, completed_at, result_json, source_context_json FROM discovery_research WHERE target_key=? ORDER BY id DESC LIMIT 50",
					[String(target.key)],
				).map((item) => ({
					...item,
					result: parseJson(item.result_json),
					sourceContext: parseJson(item.source_context_json, []),
				}))
			: [];
		return {
			...target,
			result: parseJson(target.result_json),
			edges,
			research,
		};
	});
	const provenance: Row[] = [];
	if (available.provenance) {
		for (const item of rows(
			db,
			"SELECT source, details_json FROM recovery_provenance ORDER BY source",
		)) {
			const details = parseJson(item.details_json, {}) as Row;
			const observations = Array.isArray(details.discovery_observations)
				? (details.discovery_observations as Row[]).filter(
						(observation) =>
							observation.target === repo.url ||
							observation.target === repo.name_with_owner,
					)
				: [];
			if (observations.length)
				provenance.push({ source: item.source, observations });
		}
	}
	return { available: true, targets, provenance };
}

function handleRepositoryProfile(url: URL, db: Database): Response {
	let key = url.searchParams.get("key") ?? "";
	const match = url.pathname.match(/^\/research\/repository\/(.+)$/);
	if (!key && match) key = decodeURIComponent(match[1]);
	if (!key.trim())
		return response(
			{ error: "Provide key=<owner/repo|GitHub node ID|database ID>" },
			400,
		);
	const found = repositoryByKey(key.trim(), db);
	if (!found) return response({ error: "Repository not found", key }, 404);
	const id = Number(found.id);
	const includeReadme = url.searchParams.get("includeReadme") === "true";
	const history = rows(
		db,
		`SELECT s.run_id, mr.created_at AS run_created_at, mr.notes AS run_notes, s.list_slug, s.score, s.rationale
		 FROM repo_list_score s JOIN model_run mr ON mr.id=s.run_id WHERE s.repo_id=?
		 ORDER BY s.run_id DESC, s.score DESC LIMIT 200`,
		[id],
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
		discovery: profileDiscovery(db, found),
	});
}

function handleTopics(url: URL, db: Database): Response {
	if (!tableExists(db, "topics"))
		return response(
			{ error: "Topic enrichment tables are not initialized" },
			503,
		);
	const topic = url.searchParams.get("topic")?.trim();
	if (!topic) {
		const limit = Math.max(
			1,
			Math.min(200, Number(url.searchParams.get("limit")) || 50),
		);
		return response({
			topics: rows(
				db,
				`SELECT t.*, COUNT(DISTINCT rt.repo_id) AS repositories FROM topics t LEFT JOIN repo_topics rt ON rt.topic=t.topic GROUP BY t.topic ORDER BY repositories DESC, t.topic LIMIT ?`,
				[limit],
			),
		});
	}
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
	const repositoryRows = rows(
		db,
		"SELECT r.* FROM repo_topics rt JOIN repo r ON r.id=rt.repo_id WHERE rt.topic=? ORDER BY COALESCE(r.popularity,0) DESC LIMIT 100",
		[slug],
	).map((row) => decodeRepo(row));
	return response({
		topic: alias,
		aliases: aliases.map((item) => item.alias),
		related: related.map((edge) => (edge.a === slug ? edge.b : edge.a)),
		repositories: attachRelations(db, repositoryRows),
	});
}

function handleDiscoveries(url: URL, db: Database): Response {
	const available = optionalResearchTables(db);
	if (!available.targets)
		return response({ available: false, discoveries: [] });
	const params = url.searchParams;
	const limit = Math.max(1, Math.min(100, Number(params.get("limit")) || 20));
	const offset = Math.max(0, Number(params.get("offset")) || 0);
	const where = ["1=1"];
	const values: SQLQueryBindings[] = [];
	for (const field of ["status", "repo_node_id"] as const) {
		const value = params.get(field)?.trim();
		if (value) {
			where.push(`t.${field}=?`);
			values.push(value);
		}
	}
	const source = params.get("source")?.trim();
	if (source && available.edges) {
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
	).map((target) => {
		const edges = available.edges
			? rows(
					db,
					"SELECT source, observation_json FROM discovery_edge WHERE target_key=? ORDER BY source",
					[String(target.key)],
				).map((edge) => ({
					source: edge.source,
					observation: parseJson(edge.observation_json, {}),
				}))
			: [];
		const research = available.research
			? rows(
					db,
					"SELECT id, completed_at, result_json, source_context_json FROM discovery_research WHERE target_key=? ORDER BY id DESC LIMIT 20",
					[String(target.key)],
				).map((item) => ({
					...item,
					result: parseJson(item.result_json),
					sourceContext: parseJson(item.source_context_json, []),
				}))
			: [];
		return {
			...target,
			result: parseJson(target.result_json),
			edges,
			research,
		};
	});
	return response({
		available: true,
		page: { total, limit, offset, hasMore: offset + targets.length < total },
		discoveries: targets,
	});
}

export function handleResearchApi(url: URL, db: Database): Response | null {
	if (url.pathname === "/research/overview") return handleOverview(db);
	if (url.pathname === "/research/repositories")
		return handleRepositorySearch(url, db);
	if (
		url.pathname === "/research/repository" ||
		url.pathname.startsWith("/research/repository/")
	)
		return handleRepositoryProfile(url, db);
	if (url.pathname === "/research/topics") return handleTopics(url, db);
	if (url.pathname === "/research/discoveries")
		return handleDiscoveries(url, db);
	return null;
}
