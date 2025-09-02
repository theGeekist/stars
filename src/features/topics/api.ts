// src/features/topics/api.ts
import { db } from "@lib/db";
import type { Statement } from "bun:sqlite";
import { githubREST, sleep, jitter } from "@lib/github";

// ── Types ─────────────────────────────────────────────────────────────────────
export type RepoRef = { owner: string; name: string };

export type TopicMeta = {
	name: string;
	displayName?: string | null;
	shortDescription?: string | null;
	aliases?: string[];
	isFeatured?: boolean;
};

export type TopicRow = {
	topic: string;
	display_name?: string | null;
	short_description?: string | null;
	aliases?: string[] | null;
	is_featured?: boolean;
	updated_at?: string;
	etag?: string | null;
};

// ── Prepared statements ───────────────────────────────────────────────────────
let uTopic!: Statement<
	unknown,
	[
		topic: string,
		display_name: string | null,
		short_description: string | null,
		aliases_json: string | null,
		is_featured: number,
		updated_at: string,
		etag: string | null,
	]
>;

let uRepoTopic!: Statement<
	unknown,
	[repo_id: number, topic: string, added_at: string]
>;

function prepare(): void {
	if (uTopic && uRepoTopic) return;

	uTopic = db.query<
		unknown,
		[
			string,
			string | null,
			string | null,
			string | null,
			number,
			string,
			string | null,
		]
	>(`
    INSERT INTO topics (topic, display_name, short_description, aliases_json, is_featured, updated_at, etag)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic) DO UPDATE SET
      display_name      = excluded.display_name,
      short_description = excluded.short_description,
      aliases_json      = excluded.aliases_json,
      is_featured       = excluded.is_featured,
      updated_at        = excluded.updated_at,
      etag              = COALESCE(excluded.etag, topics.etag)
  `);

	uRepoTopic = db.query<unknown, [number, string, string]>(`
    INSERT INTO repo_topics (repo_id, topic, added_at)
    VALUES (?, ?, ?)
    ON CONFLICT(repo_id, topic) DO UPDATE SET added_at = excluded.added_at
  `);
}

// ── API ───────────────────────────────────────────────────────────────────────
export function upsertTopic(row: TopicRow): void {
	prepare();
	const now = row.updated_at ?? new Date().toISOString();
	const aliases_json = row.aliases ? JSON.stringify(row.aliases) : null;
	uTopic.run(
		row.topic,
		row.display_name ?? null,
		row.short_description ?? null,
		aliases_json,
		row.is_featured ? 1 : 0,
		now,
		row.etag ?? null,
	);
}

export function upsertRepoTopics(repoId: number, topics: string[]): void {
	prepare();
	const ts = new Date().toISOString();
	const tx = db.transaction(() => {
		for (const t of topics) uRepoTopic.run(repoId, t, ts);
	});
	tx();
}

export function reconcileRepoTopics(repoId: number, topics: string[]): void {
	prepare();
	const ts = new Date().toISOString();

	const tx = db.transaction(() => {
		for (const t of topics) uRepoTopic.run(repoId, t, ts);

		const placeholders = topics.length
			? new Array(topics.length).fill("?").join(",")
			: "''";
		const del = db.query<unknown, (number | string)[]>(
			`DELETE FROM repo_topics WHERE repo_id = ? AND topic NOT IN (${placeholders})`,
		);
		del.run(repoId, ...topics);
	});
	tx();
}

export function selectStaleTopics(
	universeJson: string,
	ttlDays: number,
): { topic: string }[] {
	const q = db.query<{ topic: string }, [string, number]>(`
    SELECT u.topic
    FROM (SELECT value AS topic FROM json_each(?)) AS u
    LEFT JOIN topics t ON t.topic = u.topic
    WHERE t.topic IS NULL
       OR julianday('now') - julianday(t.updated_at) > ?
  `);
	return q.all(universeJson, ttlDays);
}

// ── Topic utils ──────────────────────────────────────────────────────────────
export function normalizeTopics(topics: string[]): string[] {
	const seen = new Set<string>();
	for (const t of topics) {
		const k = t.toLowerCase().replace(/\s+/g, "-").trim();
		if (k) seen.add(k);
	}
	return [...seen];
}

// ── GitHub API wrappers ──────────────────────────────────────────────────────
export async function repoTopics(
	token: string,
	owner: string,
	name: string,
): Promise<string[]> {
	const json = await githubREST<{ names?: string[] }>(
		token,
		`/repos/${owner}/${name}/topics`,
		{
			acceptPreview: true,
		},
	);
	return normalizeTopics(json.names ?? []);
}

export async function repoTopicsMany(
	token: string,
	repos: RepoRef[],
	opts: { concurrency?: number } = {},
): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>();
	const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));

	let i = 0;
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (i < repos.length) {
				const idx = i++;
				const r = repos[idx];
				const key = `${r.owner}/${r.name}`;
				try {
					const ts = await repoTopics(token, r.owner, r.name);
					out.set(key, ts);
				} catch (err) {
					console.error(`[topics] failed ${key}:`, err);
					out.set(key, []);
				}
				await sleep(jitter(75));
			}
		}),
	);
	return out;
}

export async function topicMetaMany(
	token: string,
	topics: string[],
	opts: { concurrency?: number } = {},
): Promise<Map<string, TopicMeta | null>> {
	const uniq = normalizeTopics(topics);
	const out = new Map<string, TopicMeta | null>();
	const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? 3));

	let i = 0;
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (i < uniq.length) {
				const idx = i++;
				const t = uniq[idx];
				try {
					const data = await githubREST<{ items?: any[] }>(
						token,
						`/search/topics?q=${encodeURIComponent(t)}`,
						{ acceptPreview: true },
					);
					const hit =
						data.items?.find(
							(it) => it.name?.toLowerCase() === t.toLowerCase(),
						) ?? data.items?.[0];
					out.set(
						t,
						hit
							? {
									name: hit.name,
									displayName: hit.display_name ?? hit.name,
									shortDescription:
										hit.short_description ?? hit.description ?? null,
									aliases: hit.aliases ?? [],
									isFeatured: !!hit.featured,
								}
							: null,
					);
				} catch (err) {
					console.error(`[topicMeta] failed "${t}":`, err);
					out.set(t, null);
				}
				await sleep(jitter(100));
			}
		}),
	);
	return out;
}
