// src/lib/readme.ts
import { db, initSchema } from "./db";
import { Document, SentenceSplitter, TokenTextSplitter } from "llamaindex";
import type { ChunkingOptions, ReadmeRow } from "./types";

initSchema();
const qReadme = db.query<ReadmeRow, [number]>(`
  SELECT id, readme_md, readme_etag FROM repo WHERE id = ?
`);

const uReadmeAll = db.query<
  unknown,
  [string | null, string | null, string, number]
>(`
  UPDATE repo
  SET readme_md = ?, readme_etag = ?, readme_fetched_at = ?
  WHERE id = ?
`);

const uReadmeFetchedAt = db.query<unknown, [string, number]>(`
  UPDATE repo
  SET readme_fetched_at = ?
  WHERE id = ?
`);

// --- helpers -----------------------------------------------------------------
function getGitHubToken(): string | undefined {
  // Prefer GITHUB_TOKEN; fallback to GH_TOKEN
  return Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN ?? undefined;
}

function headersWithAuth(etag?: string) {
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3.raw",
    "User-Agent": "geekist-readme-fetcher",
  };
  const token = getGitHubToken();
  if (token) h.Authorization = `Bearer ${token}`;
  if (etag) h["If-None-Match"] = etag;
  return h;
}

// --- fetch + cache -----------------------------------------------------------
/**
 * Fetch README with ETag caching and persist:
 * - 200: save (readme_md, readme_etag, readme_fetched_at)
 * - 304: keep readme_md/etag, update readme_fetched_at
 * - 404: return null (no update)
 * - other errors: log & return cached; bump fetched_at so we know we tried
 */
export async function fetchReadmeWithCache(
  repoId: number,
  nameWithOwner: string,
  maxBytes = 200_000,
  forceRefresh = false
): Promise<string | null> {
  const [owner, repo] = nameWithOwner.split("/");
  const existing = qReadme.get(repoId);
  const etagHint = forceRefresh
    ? undefined
    : existing?.readme_etag ?? undefined;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
    { headers: headersWithAuth(etagHint) }
  );

  const now = new Date().toISOString();

  // 304 → unchanged, bump fetched_at and return cached
  if (res.status === 304) {
    if (existing?.readme_md) {
      uReadmeFetchedAt.run(now, repoId); // keep a record that we checked
      return existing.readme_md;
    }
    // theoretically 304 with no cache; treat as miss
    return null;
  }

  // 404 → no README
  if (res.status === 404) return null;

  // Other non-OK → log & fallback; still bump fetched_at so we don't hammer repeatedly
  if (!res.ok) {
    const remain = res.headers.get("X-RateLimit-Remaining");
    const reset = res.headers.get("X-RateLimit-Reset");
    console.warn(
      `GitHub ${res.status} ${res.statusText} for ${nameWithOwner} (remaining=${
        remain ?? "?"
      }, reset=${reset ?? "?"})`
    );
    if (existing?.readme_md) uReadmeFetchedAt.run(now, repoId);
    return existing?.readme_md ?? null;
  }

  // 200 OK → store README + ETag + fetched_at
  const body = await res.text();
  const md = body.slice(0, maxBytes);
  const etag = res.headers.get("ETag") ?? null;

  uReadmeAll.run(md, etag, now, repoId);
  return md;
}

// --- clean + chunk -----------------------------------------------------------
export function cleanMarkdown(md: string): string {
  const withoutFrontmatter = md.replace(/^---\s*[\s\S]*?\s*---\s*\n/, "");
  return withoutFrontmatter
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkMarkdown(
  md: string,
  opts: ChunkingOptions = {}
): string[] {
  const {
    chunkSizeTokens = 768,
    chunkOverlapTokens = 80,
    mode = "sentence",
  } = opts;
  const doc = new Document({ text: md });
  if (mode === "sentence") {
    const splitter = new SentenceSplitter({
      chunkSize: chunkSizeTokens,
      chunkOverlap: chunkOverlapTokens,
    });
    return splitter.splitText(doc.getText());
  } else {
    const splitter = new TokenTextSplitter({
      chunkSize: chunkSizeTokens,
      chunkOverlap: chunkOverlapTokens,
    });
    return splitter.splitText(doc.getText());
  }
}

/** fetch + clean + chunk (cached) */
export async function fetchAndChunkReadmeCached(
  repoId: number,
  nameWithOwner: string,
  options?: ChunkingOptions
): Promise<string[]> {
  const raw = await fetchReadmeWithCache(repoId, nameWithOwner);
  if (!raw) return [];
  const clean = cleanMarkdown(raw);
  return chunkMarkdown(clean, options);
}
