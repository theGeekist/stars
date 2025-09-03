// src/topics-report.ts

import { log } from "@lib/bootstrap";
import { getDefaultDb } from "@lib/db";

function fmt(n: number) {
	return new Intl.NumberFormat("en").format(n);
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

function getTotals() {
	const db = getDefaultDb();
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
		.query<{ c: number }, []>(
			`SELECT COUNT(*) c FROM topics WHERE short_description IS NOT NULL AND short_description <> ''`,
		)
		.get()?.c;

	const topicsLong = db
		.query<{ c: number }, []>(
			`SELECT COUNT(*) c FROM topics WHERE long_description_md IS NOT NULL AND long_description_md <> ''`,
		)
		.get()?.c;

	return { repos, unique, topicsTotal, topicsShort, topicsLong };
}

/** ALL topics with usage count + metadata + aliases (no limit). */
function getAllTopics() {
	const db = getDefaultDb();
	const q = db.query<
		{
			topic: string;
			display_name: string | null;
			short_description: string | null;
			long_description_md: string | null;
			cnt: number;
			alias_csv: string | null;
			alias_count: number;
		},
		[]
	>(`
    SELECT
      t.topic,
      COALESCE(t.display_name, t.topic)            AS display_name,
      t.short_description,
      t.long_description_md,
      COUNT(rt.repo_id)                            AS cnt,
      (
        SELECT GROUP_CONCAT(a.alias, ', ')
        FROM (SELECT DISTINCT alias FROM topic_alias WHERE topic = t.topic) a
      )                                            AS alias_csv,
      (
        SELECT COUNT(*) FROM (SELECT DISTINCT alias FROM topic_alias WHERE topic = t.topic)
      )                                            AS alias_count
    FROM topics t
    LEFT JOIN repo_topics rt ON rt.topic = t.topic
    GROUP BY t.topic
    ORDER BY cnt DESC, t.topic ASC
  `);
	return q.all();
}

function getMissingMeta(limit = 50) {
	// “Missing” means both short & long are empty
	const db = getDefaultDb();
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

function getRecentTopics(limit = 50) {
	const db = getDefaultDb();
	const q = db.query<{ topic: string; added_at: string }, [number]>(`
    SELECT topic, MAX(added_at) AS added_at
    FROM repo_topics
    GROUP BY topic
    ORDER BY added_at DESC
    LIMIT ?
  `);
	return q.all(limit);
}

export async function topicsReport(opts?: {
	full?: boolean; // show full descriptions & aliases (no truncation)
	showMissing?: boolean;
	showRecent?: boolean;
	json?: boolean;
}) {
	const totals = getTotals();
	const all = getAllTopics();
	const missing = opts?.showMissing ? getMissingMeta(50) : [];
	const recent = opts?.showRecent ? getRecentTopics(50) : [];
	const full = !!opts?.full;

	// Normalize rows for display/JSON
	const rows = all.map((t) => {
		const descRaw =
			(t.short_description?.trim()
				? t.short_description?.trim()
				: firstParagraph(t.long_description_md)) || "";
		const aliases = (t.alias_csv ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		return {
			topic: t.topic,
			display_name: t.display_name ?? t.topic,
			repos: t.cnt,
			aliases,
			alias_count: t.alias_count ?? 0,
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
			{ Metric: "Repos", Value: fmt(totals.repos as number) },
			{ Metric: "Unique topics (used)", Value: fmt(totals.unique as number) },
			{ Metric: "Topics in DB", Value: fmt(totals.topicsTotal as number) },
			{ Metric: "With short desc", Value: fmt(totals.topicsShort as number) },
			{ Metric: "With long desc", Value: fmt(totals.topicsLong as number) },
		].map((r) => ({ Metric: String(r.Metric), Value: String(r.Value) })), // force strings
		["Metric", "Value"],
	);

	// --- All topics table ---
	log.header(`All topics (${fmt(rows.length)}) by repo usage`);
	log.columns(
		rows.map((t) => ({
			Topic: String(t.display_name || t.topic || "-"),
			Slug: String(t.topic || "-"),
			Repos: fmt(t.repos ?? 0),
			Aliases: full
				? t.aliases.length
					? t.aliases.join(", ")
					: "-"
				: truncate(t.aliases.length ? t.aliases.join(", ") : "-", 100),
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

// Optional: run as a standalone script
if (import.meta.main) {
	const args = new Set(Bun.argv.slice(2));
	const full = args.has("--full");
	const showMissing = args.has("--missing");
	const showRecent = args.has("--recent");
	const json = args.has("--json");
	await topicsReport({ full, showMissing, showRecent, json });
}
