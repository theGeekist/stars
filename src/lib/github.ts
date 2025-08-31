// src/lib/github.ts
// Minimal resilient GraphQL client for GitHub with retries, timeout, and rate-limit handling.

export type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

const GITHUB_GQL = "https://api.github.com/graphql";
const DEFAULT_TIMEOUT_MS = Number(Bun.env.GQL_TIMEOUT_MS ?? 30000);       // 30s
const MAX_RETRIES = Number(Bun.env.GQL_MAX_RETRIES ?? 6);                // attempts
const BASE_DELAY_MS = Number(Bun.env.GQL_BASE_DELAY_MS ?? 400);          // backoff base

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number) {
  // Full jitter (AWS style)
  return Math.floor(Math.random() * ms);
}

function shouldRetry(status: number): boolean {
  // Retry on 5xx; 429/403 may be secondary rate limit
  return status >= 500 || status === 429 || status === 403;
}

function getRetryAfterSeconds(res: Response): number | null {
  const ra = res.headers.get("retry-after");
  if (!ra) return null;
  const n = Number(ra);
  return Number.isFinite(n) ? n : null;
}

export async function githubGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const ua = Bun.env.GQL_USER_AGENT ?? "geek-stars/0.1 (https://github.com/theGeekist/stars)";
  const body = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await fetch(GITHUB_GQL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": ua,
        },
        body,
      });

      clearTimeout(timer);

      // Secondary rate limit handling
      if (shouldRetry(res.status)) {
        const ra = getRetryAfterSeconds(res);
        if (ra) {
          await sleep(ra * 1000);
          continue;
        }
        if (attempt < MAX_RETRIES - 1) {
          const backoff = jitter(Math.min(32000, BASE_DELAY_MS * 2 ** attempt));
          await sleep(backoff);
          continue;
        }
        const text = await res.text();
        throw new Error(`GitHub GraphQL HTTP ${res.status}: ${text}`);
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub GraphQL HTTP ${res.status}: ${text}`);
      }

      const json = (await res.json()) as GraphQLResponse<T>;
      if (json.errors && json.errors.length) {
        // Some GraphQL errors are transient; allow retry on “Something went wrong” style
        const msg = json.errors.map((e) => e.message).join("; ");
        const transient = /timeout|temporar|try again|internal|something went wrong/i.test(msg);
        if (transient && attempt < MAX_RETRIES - 1) {
          const backoff = jitter(Math.min(32000, BASE_DELAY_MS * 2 ** attempt));
          await sleep(backoff);
          continue;
        }
        throw new Error(`GitHub GraphQL error: ${msg}`);
      }
      if (!json.data) throw new Error("GitHub GraphQL: empty data");

      return json.data;
    } catch (err: unknown) {
      clearTimeout(timer);
      // Network / abort errors → retry
      if (attempt < MAX_RETRIES - 1) {
        const backoff = jitter(Math.min(32000, BASE_DELAY_MS * 2 ** attempt));
        await sleep(backoff);
        continue;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  // Should never reach here
  throw new Error("GitHub GraphQL: exhausted retries");
}

export const gql = String.raw;
