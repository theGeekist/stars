// src/features/topics/api.ts
import type { Database } from "bun:sqlite";
import { log } from "@lib/bootstrap";
import { withDB } from "@lib/db";
import type { NoRow, RepoRef, TopicMeta, TopicRow } from "./types";

/* ─────────────────────────── Helpers ─────────────────────────── */

/* ────────────────────────────── API writers ─────────────────────────────── */

export function upsertTopic(row: TopicRow, database?: Database): void {
	const db = withDB(database);
	const now = row.updated_at ?? new Date().toISOString();
	const uTopic = db.query<
		NoRow,
		[
			string,
			string | null,
			string | null,
			string | null,
			number,
			string | null,
			string | null,
			string | null,
			string | null,
			string,
			string | null,
		]
	>(`
    INSERT INTO topics (
      topic, display_name, short_description, long_description_md,
      is_featured, created_by, released, wikipedia_url, logo,
      updated_at, etag
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic) DO UPDATE SET
      display_name        = excluded.display_name,
      short_description   = excluded.short_description,
      long_description_md = excluded.long_description_md,
      is_featured         = excluded.is_featured,
      created_by          = excluded.created_by,
      released            = excluded.released,
      wikipedia_url       = excluded.wikipedia_url,
      logo                = excluded.logo,
      updated_at          = excluded.updated_at,
      etag                = COALESCE(excluded.etag, topics.etag)
  `);
	uTopic.run(
		row.topic,
		row.display_name ?? null,
		row.short_description ?? null,
		row.long_description_md ?? null,
		row.is_featured ? 1 : 0,
		row.created_by ?? null,
		row.released ?? null,
		row.wikipedia_url ?? null,
		row.logo ?? null,
		now,
		row.etag ?? null,
	);
}

export function upsertTopicAliases(
	topic: string,
	aliases: string[] | undefined,
	database?: Database,
): void {
	const db = withDB(database);
	if (!aliases?.length) return;
	const tx = db.transaction(() => {
		for (const a of aliases) {
			const alias = normalizeOne(a);
			if (!alias || alias === topic) continue;
			const uAlias = db.query<NoRow, [string, string]>(
				`INSERT OR REPLACE INTO topic_alias (alias, topic) VALUES (?, ?)`,
			);
			uAlias.run(alias, topic);
		}
	});
	tx();
}

export function upsertTopicRelated(
	topic: string,
	related: string[] | undefined,
	database?: Database,
): void {
	const db = withDB(database);
	if (!related?.length) return;
	const tx = db.transaction(() => {
		for (const r of related) {
			const other = normalizeOne(r);
			if (!other || other === topic) continue;
			const [a, b] = topic < other ? [topic, other] : [other, topic];
			const uRelated = db.query<NoRow, [string, string]>(
				`INSERT OR IGNORE INTO topic_related (a, b) VALUES (?, ?)`,
			);
			uRelated.run(a, b);
		}
	});
	tx();
}

/* ───────────────────────────── Topic utilities ──────────────────────────── */

export function normalizeTopics(topics: string[]): string[] {
	const seen = new Set<string>();
	for (const t of topics) {
		const k = normalizeOne(t);
		if (k) seen.add(k);
	}
	return [...seen];
}
function normalizeOne(t: string | null | undefined): string {
	return (t ?? "").toLowerCase().trim().replace(/\s+/g, "-");
}

/* ───────────────── DB-only “fetchers” (no network) ──────────────────────── */

/** Read topics for a set of repos from our repo table’s JSON `topics` field. */
export function repoTopicsMany(
	refs: RepoRef[],
	_opts?: { concurrency?: number },
	database?: Database,
): Map<string, string[]> {
	const db = withDB(database);
	// Build a set of names we need and map back in the end.
	const want = new Set(refs.map((r) => `${r.owner}/${r.name}`));
	const placeholders = Array.from({ length: want.size }, () => "?").join(",");
	const q = db.query<
		{ name_with_owner: string; topics: string | null },
		string[]
	>(`
    SELECT name_with_owner, topics FROM repo
    WHERE name_with_owner IN (${placeholders})
  `);
	const rows = q.all(...want);

	const byName = new Map<string, string[]>();
	for (const row of rows) {
		let raw: unknown = [];
		try {
			raw = row.topics ? JSON.parse(row.topics) : [];
		} catch {}
		const arr = Array.isArray(raw)
			? raw.filter((s) => typeof s === "string")
			: [];
		byName.set(row.name_with_owner, normalizeTopics(arr));
	}

	// Ensure all requested names have an entry (even if empty)
	for (const key of want) if (!byName.has(key)) byName.set(key, []);
	return byName;
}

/**
 * Read topic metadata from the local github/explore clone indicated by GH_EXPLORE_PATH.
 * Expects files like: $GH_EXPLORE_PATH/topics/<slug>/index.md
 */
export function topicMetaMany(
	topics: string[],
	_opts?: { concurrency?: number },
): Map<string, TopicMeta | null> {
	const base = Bun.env.GH_EXPLORE_PATH;
	if (!base) {
		log.warn("GH_EXPLORE_PATH not set; topicMetaMany will return nulls.");
		return new Map(topics.map((t) => [normalizeOne(t), null]));
	}

	const fs = require("node:fs");
	const path = require("node:path");
	const out = new Map<string, TopicMeta | null>();

	for (const raw of topics) {
		const slug = normalizeOne(raw);
		const mdPath = path.resolve(base, "topics", slug, "index.md");
		if (!fs.existsSync(mdPath)) {
			out.set(slug, null);
			continue;
		}

		try {
			const txt = fs.readFileSync(mdPath, "utf8");
			const { fm, body } = splitFrontMatter(txt);
			const meta = frontMatterToMeta(slug, fm, body);
			out.set(slug, meta);
		} catch (e) {
			log.warn(
				`topicMetaMany: failed to read ${slug}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			);
			out.set(slug, null);
		}
	}
	return out;
}

/* ──────────────────────── tiny front-matter parser ──────────────────────── */

function splitFrontMatter(src: string): { fm: string; body: string } {
	if (src.startsWith("---")) {
		const i = src.indexOf("\n---", 3);
		if (i !== -1) {
			const fm = src.slice(3, i).trim();
			const body = src.slice(i + 4).trim();
			return { fm, body };
		}
	}
	return { fm: "", body: src };
}

// very small YAML-ish parser that handles key: value, key: [a, b], and
// simple list forms for the fields we care about.
function parseFM(yaml: string): Record<string, unknown> {
	const obj: Record<string, unknown> = {};
	const lines = yaml.split(/\r?\n/);
	let i = 0;
	while (i < lines.length) {
		const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(lines[i]);
		if (!m) {
			i++;
			continue;
		}
		const key = m[1];
		const val = m[2];

		if (val === "" && i + 1 < lines.length && /^\s*- /.test(lines[i + 1])) {
			// block list
			const arr: string[] = [];
			i++;
			while (i < lines.length && /^\s*- /.test(lines[i])) {
				arr.push(lines[i].replace(/^\s*-\s*/, "").trim());
				i++;
			}
			obj[key] = arr;
			continue;
		}

		if (/^\[.*\]$/.test(val)) {
			// inline list: [a, b, c]
			const items = val
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			obj[key] = items;
		} else {
			obj[key] = val === "" ? null : val;
		}
		i++;
	}
	return obj;
}

function frontMatterToMeta(
	slug: string,
	fmText: string,
	body: string,
): TopicMeta {
	const fm = parseFM(fmText);
	const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];
	const related = Array.isArray(fm.related) ? (fm.related as string[]) : [];

	return {
		name: slug,
		displayName: (fm.display_name as string) ?? slug,
		shortDescription:
			(fm.short_description as string) ??
			(typeof body === "string" && body.length ? body.slice(0, 140) : null),
		longDescriptionMd: body || null,
		aliases,
		related,
		isFeatured: !!fm.featured,
		createdBy: (fm.created_by as string) ?? null,
		released: (fm.released as string) ?? null,
		wikipediaUrl: (fm.wikipedia_url as string) ?? null,
		logo: (fm.logo as string) ?? null,
	};
}

/* ───────────────────── Repo topic reconciliation (unchanged) ───────────── */

export function upsertRepoTopics(
	repoId: number,
	topics: string[],
	database?: Database,
): void {
	const db = withDB(database);
	const ts = new Date().toISOString();
	const tx = db.transaction(() => {
		const uRepoTopic = db.query<NoRow, [number, string, string]>(`
		  INSERT INTO repo_topics (repo_id, topic, added_at)
		  VALUES (?, ?, ?)
		  ON CONFLICT(repo_id, topic) DO UPDATE SET added_at = excluded.added_at
		`);
		for (const t of topics) uRepoTopic.run(repoId, t, ts);
	});
	tx();
}

export function reconcileRepoTopics(
	repoId: number,
	topics: string[],
	database?: Database,
): void {
	const db = withDB(database);
	const ts = new Date().toISOString();

	const ensure = db.query<NoRow, [string, string, string]>(`
    INSERT INTO topics (
      topic, display_name, short_description, long_description_md,
      is_featured, created_by, released, wikipedia_url, logo,
      updated_at, etag
    )
    VALUES (?, ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?, NULL)
    ON CONFLICT(topic) DO NOTHING
  `);

	const placeholders = topics.length
		? new Array(topics.length).fill("?").join(",")
		: "''";

	const tx = db.transaction(() => {
		for (const t of topics) ensure.run(t, t, ts);
		const uRepoTopic = db.query<NoRow, [number, string, string]>(`
		  INSERT INTO repo_topics (repo_id, topic, added_at)
		  VALUES (?, ?, ?)
		  ON CONFLICT(repo_id, topic) DO UPDATE SET added_at = excluded.added_at
		`);
		for (const t of topics) uRepoTopic.run(repoId, t, ts);
		const del = db.query<NoRow, (number | string)[]>(`
      DELETE FROM repo_topics WHERE repo_id = ? AND topic NOT IN (${placeholders})
    `);
		del.run(repoId, ...topics);
	});
	tx();
}

export function selectStaleTopics(
	universeJson: string,
	ttlDays: number,
	database?: Database,
): { topic: string }[] {
	const db = withDB(database);
	// Treat rows with missing meta as stale regardless of TTL.
	const q = db.query<{ topic: string }, [string, number]>(`
    SELECT u.topic
    FROM (SELECT value AS topic FROM json_each(?)) AS u
    LEFT JOIN topics t ON t.topic = u.topic
    WHERE t.topic IS NULL
       OR t.short_description IS NULL
       OR t.long_description_md IS NULL
       OR (julianday('now') - julianday(COALESCE(t.updated_at, '1970-01-01'))) > ?
  `);
	return q.all(universeJson, ttlDays);
}
