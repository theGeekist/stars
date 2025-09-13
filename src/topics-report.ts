// src/topics-report.ts
import type { Database } from "bun:sqlite";
import { log } from "@lib/bootstrap";
import { withDB } from "@lib/db";

/* ───────────────── helpers ───────────────── */

function fmt(n: number | undefined | null) {
	return new Intl.NumberFormat("en").format(Number(n ?? 0));
}
function truncate(s: string, n = 120) {
	const v = (s ?? "").trim();
	if (!v) return "-";
	return v.length <= n ? v : `${v.slice(0, n - 1)}…`;
}
function firstParagraph(md?: string | null): string {
	const body = (md ?? "").trim();
	if (!body) return "";
	const para = body.split(/\n\s*\n/)[0] || body.split("\n")[0] || body;
	return para
		.replace(/^#+\s*/g, "") // drop markdown headings
		.replace(/`{1,3}/g, "") // drop code backticks
		.replace(/\*\*?|__|~~/g, "") // drop bold/italic/strike
		.trim();
}

/* ───────────────── SQL ───────────────── */

function getTotals(database?: Database) {
	const db = withDB(database);
	const repos = db
		.query<{ c: number }, []>(`SELECT COUNT(*) c FROM repo`)
		.get()?.c;

	const unique = db
		.query<{ c: number }, []>(
			`SELECT COUNT(*) c FROM (SELECT DISTINCT topic FROM repo_topics)`,
		)
		.get()?.c;

	const topicsTotal = db
		.query<{ c: number }, []>(`SELECT COUNT(*) c FROM topics`)
		.get()?.c;

	const topicsShort = db
		.query<{ c: number }, []>(`
      SELECT COUNT(*) c
      FROM topics
      WHERE short_description IS NOT NULL AND short_description <> ''
    `)
		.get()?.c;

	const topicsLong = db
		.query<{ c: number }, []>(`
      SELECT COUNT(*) c
      FROM topics
      WHERE long_description_md IS NOT NULL AND long_description_md <> ''
    `)
		.get()?.c;

	return { repos, unique, topicsTotal, topicsShort, topicsLong };
}

/** ALL topics with usage count + metadata + alias stats (no row limit). */
function getAllTopics(aliasLimit = 5, database?: Database) {
	const db = withDB(database);
	const q = db.query<
		{
			topic: string;
			display_name: string | null;
			short_description: string | null;
			long_description_md: string | null;
			cnt: number;
			alias_csv: string | null;
			alias_count: number;
			alias_used_repos: number; // number of aliases that appear at least once across repos
			alias_preview_csv: string | null; // "alias:repo_cnt, alias2:repo_cnt2, ..."
		},
		[number]
	>(`
    WITH alias_set AS (
      SELECT topic, alias
      FROM topic_alias
      GROUP BY topic, alias
    ),
    alias_usage AS (
      SELECT
        ta.topic,
        LOWER(ta.alias) AS alias_lc,
        COUNT(DISTINCT r.id) AS repo_cnt
      FROM alias_set ta
      LEFT JOIN repo r ON 1=1
      LEFT JOIN json_each(r.topics) je
        ON je.value IS NOT NULL
       AND LOWER(je.value) = LOWER(ta.alias)
      GROUP BY ta.topic, alias_lc
    )
    SELECT
      t.topic,
      COALESCE(t.display_name, t.topic)          AS display_name,
      t.short_description,
      t.long_description_md,
      COUNT(rt.repo_id)                          AS cnt,
      (SELECT GROUP_CONCAT(a.alias, ', ')
         FROM (SELECT DISTINCT alias
                 FROM topic_alias
                WHERE topic = t.topic) a)        AS alias_csv,
      (SELECT COUNT(*)
         FROM (SELECT DISTINCT alias
                 FROM topic_alias
                WHERE topic = t.topic))          AS alias_count,
      (SELECT COALESCE(SUM(CASE WHEN au.repo_cnt > 0 THEN 1 ELSE 0 END), 0)
         FROM alias_usage au
        WHERE au.topic = t.topic)                AS alias_used_repos,
      (SELECT GROUP_CONCAT(alias_lc || ':' || repo_cnt, ', ')
         FROM (
               SELECT alias_lc, repo_cnt
                 FROM alias_usage
                WHERE topic = t.topic
                ORDER BY repo_cnt DESC, alias_lc ASC
                LIMIT ?
         ))                                      AS alias_preview_csv
    FROM topics t
    LEFT JOIN repo_topics rt ON rt.topic = t.topic
    GROUP BY t.topic
    ORDER BY cnt DESC, t.topic ASC
  `);
	return q.all(aliasLimit);
}

function getMissingMeta(limit = 50, database?: Database) {
	// “Missing” means both short & long are empty
	const db = withDB(database);
	const q = db.query<{ topic: string; updated_at: string | null }, [number]>(`
    SELECT topic, updated_at
    FROM topics
    WHERE (short_description IS NULL OR short_description = '')
      AND (long_description_md IS NULL OR long_description_md = '')
    ORDER BY COALESCE(updated_at, '')
    LIMIT ?
  `);
	return q.all(limit);
}

function getRecentTopics(limit = 50, database?: Database) {
	const db = withDB(database);
	const q = db.query<{ topic: string; added_at: string }, [number]>(`
    SELECT topic, MAX(added_at) AS added_at
    FROM repo_topics
    GROUP BY topic
    ORDER BY added_at DESC
    LIMIT ?
  `);
	return q.all(limit);
}

/* ───────────────── report ───────────────── */

export type AliasesMode = "none" | "count" | "preview" | "full";

export async function topicsReport(opts?: {
	full?: boolean; // full descriptions (no truncation)
	showMissing?: boolean;
	showRecent?: boolean;
	json?: boolean;
	aliasesMode?: AliasesMode; // how to display aliases (default: preview)
	aliasLimit?: number; // preview depth (default: 5)
}) {
	const full = !!opts?.full;
	const aliasesMode: AliasesMode = opts?.aliasesMode ?? "preview";
	const aliasLimit = Number.isFinite(opts?.aliasLimit)
		? Number(opts?.aliasLimit)
		: 5;

	const totals = getTotals();
	const all = getAllTopics(aliasLimit);
	const missing = opts?.showMissing ? getMissingMeta(50) : [];
	const recent = opts?.showRecent ? getRecentTopics(50) : [];

	// Normalise rows for display/JSON
	const rows = all.map((t) => {
		const descRaw =
			(t.short_description?.trim()
				? t.short_description?.trim()
				: firstParagraph(t.long_description_md)) || "";

		const aliases = (t.alias_csv ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const aliasPreviewPairs = (t.alias_preview_csv ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean); // each is "alias:count"

		return {
			topic: t.topic,
			display_name: t.display_name ?? t.topic,
			repos: t.cnt,
			aliases,
			alias_count: t.alias_count ?? 0,
			alias_used_repos: t.alias_used_repos ?? 0, // number of aliases that appear at least once
			alias_preview_pairs: aliasPreviewPairs,
			description: descRaw,
		};
	});

	if (opts?.json) {
		log.json({
			totals,
			topics: rows,
			missing,
			recent,
		});
		return;
	}

	// --- Totals ---
	log.header("Topics report");
	log.columns(
		[
			{ Metric: "Repos", Value: fmt(totals.repos) },
			{ Metric: "Unique topics (used)", Value: fmt(totals.unique) },
			{ Metric: "Topics in DB", Value: fmt(totals.topicsTotal) },
			{ Metric: "With short desc", Value: fmt(totals.topicsShort) },
			{ Metric: "With long desc", Value: fmt(totals.topicsLong) },
		].map((r) => ({ Metric: String(r.Metric), Value: String(r.Value) })),
		["Metric", "Value"],
	);

	// --- All topics table ---
	const aliasCol = (row: (typeof rows)[number]) => {
		if (aliasesMode === "none") return "-";
		const used = row.alias_used_repos ?? 0;
		const total = row.alias_count ?? 0;

		if (aliasesMode === "count") return `${used}/${total}`;

		if (aliasesMode === "preview") {
			const head = row.alias_preview_pairs.slice(0, aliasLimit).join(", ");
			const preview = head || "-";
			return `${used}/${total} · top: ${truncate(preview, 80)}`;
		}

		// full (explicit) or via --full descriptions we keep independent
		return row.aliases.length ? row.aliases.join(", ") : "-";
	};

	log.header(`All topics (${fmt(rows.length)}) by repo usage`);
	log.columns(
		rows.map((t) => ({
			Topic: String(t.display_name || t.topic || "-"),
			Slug: String(t.topic || "-"),
			Repos: fmt(t.repos ?? 0),
			Aliases: aliasCol(t),
			Description: full
				? t.description || "-"
				: truncate(t.description || "-", 140),
		})),
		["Topic", "Slug", "Repos", "Aliases", "Description"],
	);

	if (recent.length) {
		log.header("Recently added topics (latest 50)");
		log.columns(
			recent.map((r) => ({
				Topic: String(r.topic || "-"),
				"Added at": r.added_at?.replace("T", " ").slice(0, 19) ?? "-",
			})),
			["Topic", "Added at"],
		);
	}

	if (missing.length) {
		log.header("Missing metadata (first 50)");
		log.columns(
			missing.map((m) => ({
				Topic: String(m.topic || "-"),
				"Updated at": m.updated_at?.replace("T", " ").slice(0, 19) ?? "-",
			})),
			["Topic", "Updated at"],
		);
	}
}

/* ───────────────── CLI ───────────────── */

if (import.meta.main) {
	// Flags:
	//   --full               show full descriptions (no truncation)
	//   --missing            include "Missing metadata" table
	//   --recent             include "Recently added topics" table
	//   --json               output JSON instead of tables
	//   --aliases=none|count|preview|full   (default: preview)
	//   --aliasLimit=N       (default: 5; applies to preview)
	const args = Bun.argv.slice(2);

	const has = (flag: string) => args.includes(flag);
	const getArg = (name: string, def?: string) => {
		const m = args.find((a) => a.startsWith(`${name}=`));
		return m ? m.split("=")[1] : def;
	};

	const full = has("--full");
	const showMissing = has("--missing");
	const showRecent = has("--recent");
	const json = has("--json");

	const aliasesRaw = getArg("--aliases", "preview") as AliasesMode | undefined;
	const aliasesMode: AliasesMode =
		aliasesRaw === "none" ||
		aliasesRaw === "count" ||
		aliasesRaw === "preview" ||
		aliasesRaw === "full"
			? aliasesRaw
			: "preview";

	const aliasLimit = Number(getArg("--aliasLimit", "5") ?? "5");

	await topicsReport({
		full,
		showMissing,
		showRecent,
		json,
		aliasesMode,
		aliasLimit,
	});
}
