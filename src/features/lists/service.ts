import type { Database } from "bun:sqlite";
import { withDB } from "@lib/db";
import { githubGraphQL, gql } from "@lib/github";
import {
	getAllLists,
	getAllListsStream,
	LISTS_EDGES_PAGE,
	Q_REPO_ID,
} from "@lib/lists";
import type { ListsEdgesPage, RepoRow } from "@lib/types";
import type {
	BatchSelector,
	BindLimit,
	BindSlugLimit,
	ListDefRow,
	ListIdRow,
	ListListIdRow,
	ListSlugRow,
	ListsService,
	NoRow,
	RepoIdLookupRow,
} from "./types";

/** Mutations */
const M_UPDATE_LISTS_FOR_ITEM = gql`
  mutation UpdateUserListsForItem($itemId: ID!, $listIds: [ID!]!) {
    updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
      lists {
        id
        name
      }
    }
  }
`;

/** Allow injecting db and a GitHub GraphQL runner for testing */
export function createListsService(
	database?: Database,
	ghGraphQL: <T>(
		token: string,
		query: string,
		vars?: Record<string, unknown>,
	) => Promise<T> = githubGraphQL,
): ListsService {
	const db = withDB(database);
	const qReposDefault = db.query<RepoRow, BindLimit>(`
    SELECT id, name_with_owner, url, description, primary_language, topics,
           stars, forks, popularity, freshness, activeness, pushed_at, last_commit_iso, last_release_iso, updated_at, summary
    FROM repo
    ORDER BY popularity DESC NULLS LAST, freshness DESC NULLS LAST
    LIMIT ?
  `);

	const qReposBySlug = db.query<RepoRow, BindSlugLimit>(`
    SELECT r.id, r.name_with_owner, r.url, r.description, r.primary_language, r.topics,
           r.stars, r.forks, r.popularity, r.freshness, r.activeness, r.pushed_at, r.last_commit_iso, r.last_release_iso, r.updated_at, r.summary
    FROM repo r
    JOIN list_repo lr ON lr.repo_id = r.id
    JOIN list l ON l.id = lr.list_id
    WHERE l.slug = ?
    ORDER BY r.popularity DESC NULLS LAST, r.freshness DESC NULLS LAST
    LIMIT ?
  `);

	const qCurrentMembership = db.query<ListSlugRow, [number]>(`
    SELECT l.slug
    FROM list l
    JOIN list_repo lr ON lr.list_id = l.id
    WHERE lr.repo_id = ?
    ORDER BY l.name
  `);

	const qListIdBySlug = db.query<ListIdRow, [string]>(
		`SELECT id FROM list WHERE slug = ? LIMIT 1`,
	);

	const qListDefs = db.query<ListDefRow, []>(`
    SELECT slug, name, description
    FROM list
    WHERE slug != 'valuable-resources' AND slug != 'interesting-to-explore'
    ORDER BY name
  `);

	async function getReposToScore(sel: BatchSelector): Promise<RepoRow[]> {
		const limit = Math.max(1, Number(sel.limit ?? 10));
		if (sel.listSlug) return qReposBySlug.all(sel.listSlug, limit);
		return qReposDefault.all(limit);
	}

	async function currentMembership(repoId: number): Promise<string[]> {
		const rows = qCurrentMembership.all(repoId);
		return rows.map((r) => r.slug);
	}

	async function mapSlugsToGhIds(slugs: string[]): Promise<string[]> {
		const out: string[] = [];
		const qListGhIdById = db.query<ListListIdRow, [number]>(
			`SELECT list_id FROM list WHERE id = ?`,
		);

		for (const s of slugs) {
			const row = qListIdBySlug.get(s);
			if (!row) continue;
			const gh = qListGhIdById.get(row.id)?.list_id;
			if (gh) out.push(gh);
		}
		return out;
	}

	async function reconcileLocal(
		repoId: number,
		slugs: string[],
	): Promise<void> {
		const insertLr = db.query<NoRow, [string, number]>(`
      INSERT INTO list_repo (list_id, repo_id)
      VALUES ((SELECT id FROM list WHERE slug = ?), ?)
      ON CONFLICT(list_id, repo_id) DO NOTHING
    `);

		const placeholders = slugs.length ? slugs.map(() => "?").join(",") : "''";
		const deleteOther = db.query<NoRow, (number | string)[]>(`
      DELETE FROM list_repo
      WHERE repo_id = ?
        AND list_id NOT IN (SELECT id FROM list WHERE slug IN (${placeholders}))
    `);

		const tx = db.transaction(() => {
			for (const slug of slugs) insertLr.run(slug, repoId);
			deleteOther.run(repoId, ...slugs);
		});
		tx();
	}

	async function updateOnGitHub(
		token: string,
		repoGlobalId: string,
		listIds: string[],
	): Promise<void> {
		await ghGraphQL<unknown>(token, M_UPDATE_LISTS_FOR_ITEM, {
			itemId: repoGlobalId,
			listIds,
		});
	}

	async function ensureListGhIds(token: string): Promise<Map<string, string>> {
		const ghByLowerName = new Map<string, string>();
		let after: string | null = null;

		for (;;) {
			const data: ListsEdgesPage = await ghGraphQL<ListsEdgesPage>(
				token,
				LISTS_EDGES_PAGE,
				{ after },
			);
			const page = data.viewer.lists;
			for (const e of page.edges) {
				const { listId, name } = e.node;
				ghByLowerName.set(String(name).toLowerCase(), String(listId));
			}
			if (!page.pageInfo.hasNextPage) break;
			after = page.pageInfo.endCursor;
		}

		// Fill DB list.list_id where missing, by name match
		const rows = db
			.query<
				{ id: number; slug: string; name: string; list_id: string | null },
				[]
			>(`SELECT id, slug, name, list_id FROM list ORDER BY name`)
			.all();

		const slugToGh = new Map<string, string>();
		const u = db.query<NoRow, [string, number]>(
			`UPDATE list SET list_id = ? WHERE id = ?`,
		);

		for (const r of rows) {
			if (r.list_id) {
				slugToGh.set(r.slug, r.list_id);
				continue;
			}
			const ghId = ghByLowerName.get(r.name.toLowerCase());
			if (ghId) {
				u.run(ghId, r.id);
				slugToGh.set(r.slug, ghId);
			}
		}
		return slugToGh;
	}

	async function ensureRepoGhId(
		token: string,
		repoId: number,
	): Promise<string> {
		const row = db
			.query<RepoIdLookupRow, [number]>(
				`
        SELECT id, repo_id, name_with_owner, url, description, primary_language, topics, summary
        FROM repo
        WHERE id = ?
        LIMIT 1
      `,
			)
			.get(repoId);

		if (!row) throw new Error(`Repo not found id=${repoId}`);

		if (row.repo_id && /^R_kg/.test(row.repo_id)) return row.repo_id;

		const [owner, name] = (row.name_with_owner || "").split("/");
		const data = await ghGraphQL<{ repository: { id: string } }>(
			token,
			Q_REPO_ID,
			{ owner, name },
		);
		const newId = data.repository.id;

		db.query<NoRow, [string, number]>(
			`UPDATE repo SET repo_id = ? WHERE id = ?`,
		).run(newId, repoId);

		return newId;
	}

	return {
		read: {
			getAll: () => getAllLists(Bun.env.GITHUB_TOKEN ?? ""),
			getAllStream: () => getAllListsStream(Bun.env.GITHUB_TOKEN ?? ""),
			getListDefs: async () => qListDefs.all(),
			getReposToScore,
			currentMembership,
			mapSlugsToGhIds,
		},
		apply: {
			reconcileLocal,
			updateOnGitHub,
			ensureListGhIds,
			ensureRepoGhId,
		},
	};
}
