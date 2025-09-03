import { jitter } from "./rand";
import type { FetchLike } from "./types";

// src/lib/github.ts
export type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

const GITHUB_GQL = "https://api.github.com/graphql";
const DEFAULT_TIMEOUT_MS = Number(Bun.env.GQL_TIMEOUT_MS ?? 30000);
const MAX_RETRIES = Number(Bun.env.GQL_MAX_RETRIES ?? 6);
const BASE_DELAY_MS = Number(Bun.env.GQL_BASE_DELAY_MS ?? 400);
const DEBUG = !!Bun.env.DEBUG;

export function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export function shouldRetry(status: number) {
	return status >= 500 || status === 429 || status === 403;
}

export function ghHeaders(
	token: string,
	acceptPreview = false,
): Record<string, string> {
	const ua =
		Bun.env.GQL_USER_AGENT ??
		"geek-stars/0.1 (+https://github.com/theGeekist/stars)";
	const apiVersion = Bun.env.GITHUB_API_VERSION ?? "2022-11-28";
	return {
		Accept: acceptPreview
			? "application/vnd.github.mercy-preview+json"
			: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		"User-Agent": ua,
		"X-GitHub-Api-Version": apiVersion,
	};
}

export async function githubGraphQL<T>(
	token: string,
	query: string,
	variables?: Record<string, unknown>,
	fetchImpl?: FetchLike,
): Promise<T> {
	const doFetch = fetchImpl ?? fetch;
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
						variables ?? {},
					)}`,
				);
			const res = await doFetch(GITHUB_GQL, {
				method: "POST",
				signal: controller.signal,
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: `Bearer ${token}`,
					"User-Agent": ua,
					"X-GitHub-Api-Version": apiVersion,
					"X-Github-Next-Global-ID": "1", // always use new IDs
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
						} backoff=${backoff}ms`,
					);
				await sleep(backoff);
				continue;
			}
			if (!res.ok)
				throw new Error(
					`GitHub GraphQL HTTP ${res.status}: ${await res.text()}`,
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

// github.ts
export async function githubREST<T>(
	token: string,
	path: string,
	opts: { method?: string; acceptPreview?: boolean } = {},
	fetchImpl?: typeof fetch,
): Promise<T> {
	const doFetch = fetchImpl ?? fetch;
	const url = `https://api.github.com${path}`;
	const headers = ghHeaders(token, opts.acceptPreview);

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		const res = await doFetch(url, { method: opts.method ?? "GET", headers });

		if (shouldRetry(res.status) && attempt < MAX_RETRIES - 1) {
			const backoff = jitter(Math.min(32000, BASE_DELAY_MS * 2 ** attempt));
			DEBUG &&
				console.error(
					`[rest] ${path} status=${res.status} backoff=${backoff}ms`,
				);
			await sleep(backoff);
			continue;
		}

		if (!res.ok) {
			const txt = await res.text().catch(() => "");
			throw new Error(
				`${opts.method ?? "GET"} ${path} -> ${res.status} ${txt}`,
			);
		}

		return res.json() as Promise<T>;
	}

	throw new Error(`REST ${opts.method ?? "GET"} ${path} exhausted retries`);
}

export const gql = String.raw;
