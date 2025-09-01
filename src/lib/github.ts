// src/lib/github.ts
export type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

const GITHUB_GQL = "https://api.github.com/graphql";
const DEFAULT_TIMEOUT_MS = Number(Bun.env.GQL_TIMEOUT_MS ?? 30000);
const MAX_RETRIES = Number(Bun.env.GQL_MAX_RETRIES ?? 6);
const BASE_DELAY_MS = Number(Bun.env.GQL_BASE_DELAY_MS ?? 400);
const DEBUG = !!Bun.env.DEBUG;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(ms: number) {
  return Math.floor(Math.random() * ms);
}
function shouldRetry(status: number) {
  return status >= 500 || status === 429 || status === 403;
}

export async function githubGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const ua =
    Bun.env.GQL_USER_AGENT ??
    "geek-stars/0.1 (+https://github.com/theGeekist/stars)";
  const apiVersion = Bun.env.GITHUB_API_VERSION ?? "2022-11-28"; // match Explorer
  const body = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      DEBUG &&
        console.error(
          `[gql] POST attempt ${
            attempt + 1
          }/${MAX_RETRIES} timeout=${DEFAULT_TIMEOUT_MS}ms vars=${JSON.stringify(
            variables ?? {}
          )}`
        );
      const res = await fetch(GITHUB_GQL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": ua,
          "X-GitHub-Api-Version": apiVersion,
        },
        body,
      });
      clearTimeout(timer);

      if (shouldRetry(res.status) && attempt < MAX_RETRIES - 1) {
        const backoff = jitter(Math.min(32000, BASE_DELAY_MS * 2 ** attempt));
        DEBUG &&
          console.error(
            `[gql] attempt ${attempt + 1} status=${
              res.status
            } backoff=${backoff}ms`
          );
        await sleep(backoff);
        continue;
      }
      if (!res.ok)
        throw new Error(
          `GitHub GraphQL HTTP ${res.status}: ${await res.text()}`
        );

      const json = (await res.json()) as GraphQLResponse<T>;
      if (json.errors?.length) {
        const msg = json.errors.map((e) => e.message).join("; ");
        throw new Error(`GitHub GraphQL error: ${msg}`);
      }
      if (!json.data) throw new Error("GitHub GraphQL: empty data");
      DEBUG && console.error("[gql] ok");
      return json.data;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === MAX_RETRIES - 1)
        throw err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error("GitHub GraphQL: exhausted retries");
}

export const gql = String.raw;

// ───────────────────────────────────────────────────────────────────────────────
// Topic utilities: per-repo topics via GraphQL (batched) + metadata via REST
// ───────────────────────────────────────────────────────────────────────────────

export type RepoRef = { owner: string; name: string };
export type RepoTopicsRow = {
  nameWithOwner: string;
  url: string;
  updatedAt: string;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage?: string | null;
  topics: string[];
};

export type TopicMeta = {
  name: string; // canonical name
  displayName?: string | null; // pretty name (if any)
  shortDescription?: string | null;
  aliases?: string[];
  isFeatured?: boolean;
};

type SearchTopicsResponse = {
  total_count: number;
  incomplete_results?: boolean;
  items?: Array<{
    name: string;
    display_name?: string | null;
    short_description?: string | null;
    description?: string | null;
    aliases?: string[];
    featured?: boolean;
  }>;
};

// If you already have a GraphQL runner, use it instead and remove this one.
export async function runGQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const ua =
    Bun.env.GQL_USER_AGENT ??
    "geek-stars/0.1 (+https://github.com/theGeekist/stars)";
  const apiVersion = Bun.env.GITHUB_API_VERSION ?? "2022-11-28";
  const body = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      DEBUG &&
        console.error(
          `[gql] POST attempt ${
            attempt + 1
          }/${MAX_RETRIES} timeout=${DEFAULT_TIMEOUT_MS}ms vars=${JSON.stringify(
            variables ?? {}
          )}`
        );
      const res = await fetch(GITHUB_GQL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": ua,
          "X-GitHub-Api-Version": apiVersion,
        },
        body,
      });
      clearTimeout(timer);

      if (shouldRetry(res.status) && attempt < MAX_RETRIES - 1) {
        const backoff = jitter(Math.min(32000, BASE_DELAY_MS * 2 ** attempt));
        DEBUG &&
          console.error(
            `[gql] attempt ${attempt + 1} status=${
              res.status
            } backoff=${backoff}ms`
          );
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub GraphQL HTTP ${res.status}: ${text}`);
      }
      const json = (await res.json()) as GraphQLResponse<T>;
      if (json.errors?.length) {
        const msg = json.errors.map((e) => e.message).join("; ");
        throw new Error(`GitHub GraphQL error: ${msg}`);
      }
      if (!json.data) throw new Error("GitHub GraphQL: empty data");
      DEBUG && console.error("[gql] ok");
      return json.data;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === MAX_RETRIES - 1)
        throw err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error("GitHub GraphQL: exhausted retries");
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function buildReposQuery(
  aliases: { alias: string; owner: string; name: string }[],
  topicsPerRepo = 50
) {
  const parts = aliases.map(
    ({ alias, owner, name }) => `
      ${alias}: repository(owner: "${owner}", name: "${name}") {
        nameWithOwner
        url
        updatedAt
        stargazerCount
        forkCount
        primaryLanguage { name }
        repositoryTopics(first: ${topicsPerRepo}) {
          nodes { topic { name } }
        }
      }`
  );
  return `query BatchRepoTopics { ${parts.join("\n")} }`;
}

/**
 * Fetch topics + core repo fields for many repos in batches (<=20 per GQL call).
 * Batching reduces rate-limits/latency vs REST per-repo calls.
 */
export async function fetchRepoTopicsBatched(
  token: string,
  repos: RepoRef[],
  opts: { batchSize?: number; topicsPerRepo?: number } = {}
): Promise<RepoTopicsRow[]> {
  const batchSize = Math.max(1, Math.min(20, opts.batchSize ?? 20));
  const topicsPerRepo = Math.max(1, Math.min(100, opts.topicsPerRepo ?? 50));

  const rows: RepoTopicsRow[] = [];
  for (const group of chunk(repos, batchSize)) {
    const aliases = group.map((r, i) => ({ alias: `r${i}`, ...r }));
    const query = buildReposQuery(aliases, topicsPerRepo);
    const data = await runGQL<Record<string, any>>(token, query);

    for (const { alias } of aliases) {
      const node = (data as any)[alias];
      if (!node) continue;
      const topics = (node.repositoryTopics?.nodes ?? [])
        .map((n: any) => n?.topic?.name)
        .filter(Boolean)
        .map(String)
        .map((s: string) => s.trim())
        .filter(Boolean);

      rows.push({
        nameWithOwner: node.nameWithOwner,
        url: node.url,
        updatedAt: node.updatedAt,
        stargazerCount: node.stargazerCount,
        forkCount: node.forkCount,
        primaryLanguage: node.primaryLanguage?.name ?? null,
        topics: normalizeTopics(topics),
      });
    }
  }
  return rows;
}

// ───────────────────────────────────────────────────────────────────────────────
// Topic metadata enrichment via REST /search/topics (preview header)
// ───────────────────────────────────────────────────────────────────────────────

const TOPIC_ACCEPT = "application/vnd.github.mercy-preview+json";

/** Fetch a single topic’s metadata (canonical name, display name, aliases, etc.) */
export async function fetchTopicMeta(
  token: string,
  topic: string
): Promise<TopicMeta | null> {
  const ua =
    Bun.env.GQL_USER_AGENT ??
    "geek-stars/0.1 (+https://github.com/theGeekist/stars)";
  const apiVersion = Bun.env.GITHUB_API_VERSION ?? "2022-11-28";

  // Gentle retry for preview endpoints
  for (let attempt = 0; attempt < Math.min(4, MAX_RETRIES); attempt++) {
    const res = await fetch(
      `https://api.github.com/search/topics?q=${encodeURIComponent(topic)}`,
      {
        method: "GET",
        headers: {
          Accept: TOPIC_ACCEPT,
          Authorization: `Bearer ${token}`,
          "User-Agent": ua,
          "X-GitHub-Api-Version": apiVersion,
        },
      }
    );

    if (shouldRetry(res.status) && attempt < 3) {
      const backoff = jitter(Math.min(16000, BASE_DELAY_MS * 2 ** attempt));
      DEBUG &&
        console.error(
          `[topics] search "${topic}" status=${res.status} backoff=${backoff}ms`
        );
      await sleep(backoff);
      continue;
    }
    if (!res.ok) return null;

    const data = (await res.json()) as SearchTopicsResponse;
    const items = data.items ?? [];
    const hit =
      items.find((it) => it.name?.toLowerCase() === topic.toLowerCase()) ??
      items[0];

    if (!hit) return null;
    return {
      name: hit.name,
      displayName: hit.display_name ?? hit.name,
      shortDescription: hit.short_description ?? hit.description ?? null,
      aliases: hit.aliases ?? [],
      isFeatured: !!hit.featured,
    };
  }
  return null;
}

/**
 * Batch topic enrichment with in-memory de-duplication and soft concurrency.
 * Returns a map of topic -> metadata (null if not found).
 */
export async function fetchTopicMetaBatch(
  token: string,
  topics: string[],
  opts: { concurrency?: number } = {}
): Promise<Map<string, TopicMeta | null>> {
  const uniq = normalizeTopics(topics);
  const out = new Map<string, TopicMeta | null>();
  const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? 3));

  // Simple pool
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < uniq.length) {
        const idx = i++;
        const t = uniq[idx];
        if (out.has(t)) continue;
        const meta = await fetchTopicMeta(token, t);
        out.set(t, meta);
        // Tiny jitter to be nice to the preview endpoint
        await sleep(jitter(120));
      }
    })
  );

  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// High-level: annotate an existing rows[] with topics (+ optional meta)
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Given a list of { owner, name }, fetch topics and return RepoTopicsRow[].
 * You can then join/merge into your SQLite pipeline.
 */
export async function annotateReposWithTopics(
  token: string,
  repos: RepoRef[],
  opts: {
    batchSize?: number;
    topicsPerRepo?: number;
    enrichTopics?: boolean;
  } = {}
): Promise<Array<RepoTopicsRow & { topicMeta?: Record<string, TopicMeta> }>> {
  const rows = await fetchRepoTopicsBatched(token, repos, opts);
  if (!opts.enrichTopics) return rows;

  // Collect all topics across rows, enrich once, then attach per row
  const universe = [...new Set(rows.flatMap((r) => r.topics))];
  const metaMap = await fetchTopicMetaBatch(token, universe);

  return rows.map((r) => {
    const topicMeta: Record<string, TopicMeta> = {};
    for (const t of r.topics) {
      const m = metaMap.get(t);
      if (m) topicMeta[t] = m;
    }
    return { ...r, topicMeta };
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// Topics (REST): per-repo topics + global topic metadata
// ───────────────────────────────────────────────────────────────────────────────


function ghHeaders(token: string, acceptPreview = false): Record<string, string> {
  const ua =
    Bun.env.GQL_USER_AGENT ?? "geek-stars/0.1 (+https://github.com/theGeekist/stars)";
  const apiVersion = Bun.env.GITHUB_API_VERSION ?? "2022-11-28";
  return {
    Accept: acceptPreview ? "application/vnd.github.mercy-preview+json" : "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": ua,
    "X-GitHub-Api-Version": apiVersion,
  };
}

/** Normalise topic strings (lowercase, trim, collapse spaces to '-') */
export function normalizeTopics(topics: string[]): string[] {
  const seen = new Set<string>();
  for (const t of topics) {
    const k = t.toLowerCase().replace(/\s+/g, "-").trim();
    if (k) seen.add(k);
  }
  return [...seen];
}

/** Fetch topics for one repo (REST: GET /repos/{owner}/{repo}/topics) */
export async function repoTopics(
  token: string,
  owner: string,
  name: string,
): Promise<string[]> {
  const url = `https://api.github.com/repos/${owner}/${name}/topics`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: ghHeaders(token) });

    if (shouldRetry(res.status) && attempt < MAX_RETRIES - 1) {
      const backoff = jitter(Math.min(32000, BASE_DELAY_MS * 2 ** attempt));
      DEBUG && console.error(`[topics] ${owner}/${name} status=${res.status} backoff=${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`GET ${url} -> ${res.status} ${txt}`);
    }

    const json = (await res.json()) as { names?: string[] };
    return normalizeTopics(json.names ?? []);
  }
  throw new Error(`GET ${url} exhausted retries`);
}

/** Fetch topics for many repos with small concurrency (kept simple) */
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
          DEBUG && console.error(`[topics] failed ${key}:`, err);
          out.set(key, []); // don’t crash the batch
        }
        // tiny jitter to be polite
        await sleep(jitter(75));
      }
    }),
  );
  return out;
}

/** Fetch global metadata for one topic (REST: GET /search/topics?q=topic) */
export async function topicMeta(
  token: string,
  topic: string,
): Promise<TopicMeta | null> {
  const q = encodeURIComponent(topic);
  const url = `https://api.github.com/search/topics?q=${q}`;

  for (let attempt = 0; attempt < Math.min(4, MAX_RETRIES); attempt++) {
    const res = await fetch(url, { headers: ghHeaders(token, true) });

    if (shouldRetry(res.status) && attempt < 3) {
      const backoff = jitter(Math.min(16000, BASE_DELAY_MS * 2 ** attempt));
      DEBUG && console.error(`[topicMeta] "${topic}" status=${res.status} backoff=${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) return null;

    const data = (await res.json()) as {
      items?: Array<{
        name: string;
        display_name?: string | null;
        short_description?: string | null;
        description?: string | null;
        aliases?: string[];
        featured?: boolean;
      }>;
    };

    const items = data.items ?? [];
    const hit =
      items.find((it) => it.name?.toLowerCase() === topic.toLowerCase()) ?? items[0];
    if (!hit) return null;

    return {
      name: hit.name,
      displayName: hit.display_name ?? hit.name,
      shortDescription: hit.short_description ?? hit.description ?? null,
      aliases: hit.aliases ?? [],
      isFeatured: !!hit.featured,
    };
  }
  return null;
}

/** Fetch metadata for many unique topics with small concurrency */
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
        const meta = await topicMeta(token, t);
        out.set(t, meta);
        await sleep(jitter(100));
      }
    }),
  );
  return out;
}
