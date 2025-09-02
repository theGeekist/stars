import { describe, expect, it } from "bun:test";
import {
	ghHeaders,
	githubGraphQL,
	githubREST,
	gql,
	shouldRetry,
} from "./github";
import type { FetchLike } from "./types";

describe("github helpers", () => {
	it("shouldRetry matches 5xx, 429, 403 only", () => {
		expect(shouldRetry(500)).toBeTrue();
		expect(shouldRetry(503)).toBeTrue();
		expect(shouldRetry(429)).toBeTrue();
		expect(shouldRetry(403)).toBeTrue();
		expect(shouldRetry(404)).toBeFalse();
		expect(shouldRetry(400)).toBeFalse();
		expect(shouldRetry(200)).toBeFalse();
	});

	it("ghHeaders builds required headers and preview toggle", () => {
		const h1 = ghHeaders("tok");
		expect(h1.Authorization).toBe("Bearer tok");
		expect(h1.Accept).toBe("application/vnd.github+json");
		expect(typeof h1["User-Agent"]).toBe("string");
		expect(h1["User-Agent"].length > 0).toBeTrue();
		expect(typeof h1["X-GitHub-Api-Version"]).toBe("string");

		const h2 = ghHeaders("tok", true);
		expect(h2.Accept).toBe("application/vnd.github.mercy-preview+json");
	});
});

describe("githubGraphQL", () => {
	it("returns parsed data from successful response and sets headers", async () => {
		type Call = { input: RequestInfo | URL; init?: RequestInit };
		const calls: Call[] = [];
		const fakeFetch: FetchLike = async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({ input, init });
			const body = JSON.stringify({ data: { ok: true } });
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const query = gql`query { viewer { login } }`;
		const out = await githubGraphQL<{ ok: boolean }>(
			"t",
			query,
			{ a: 1 },
			fakeFetch,
		);
		expect(out.ok).toBeTrue();
		expect(calls.length).toBe(1);
		const { input, init } = calls[0];
		expect(String(input)).toContain("https://api.github.com/graphql");
		expect(init?.method).toBe("POST");
		// Required headers present
		expect((init?.headers as Record<string, string>).Authorization).toBe(
			"Bearer t",
		);
		expect(
			(init?.headers as Record<string, string>)["X-Github-Next-Global-ID"],
		).toBe("1");
		// Body includes variables as JSON
		const sent = JSON.parse(String(init?.body ?? "{}"));
		expect(sent.query).toContain("query");
		expect(sent.variables).toEqual({ a: 1 });
	});

	it("throws on GraphQL errors array", async () => {
		const fakeFetch: FetchLike = async () => {
			const body = JSON.stringify({
				errors: [{ message: "nope" }, { message: "boom" }],
			});
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		await expect(
			githubGraphQL("t", "query Q{}", {}, fakeFetch),
		).rejects.toThrow();
	});

	it("throws on non-ok HTTP", async () => {
		const fakeFetch: FetchLike = async () => {
			return new Response("bad", {
				status: 401,
				headers: { "Content-Type": "text/plain" },
			});
		};
		await expect(
			githubGraphQL("t", "query Q{}", {}, fakeFetch),
		).rejects.toThrow();
	});
});

describe("githubREST", () => {
	it("returns JSON for ok responses and uses headers", async () => {
		type Call2 = { input: RequestInfo | URL; init?: RequestInit };
		const calls: Call2[] = [];
		const fakeFetchREST = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({ input, init });
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		const data = await githubREST<{ ok: boolean }>(
			"t",
			"/user",
			{},
			fakeFetchREST,
		);
		expect(data.ok).toBeTrue();
		expect(calls.length).toBe(1);
		const { input, init } = calls[0];
		expect(String(input)).toBe("https://api.github.com/user");
		const headers = init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer t");
		expect(headers.Accept).toBe("application/vnd.github+json");
	});

	it("throws with status text on error", async () => {
		const fakeFetch = (async () =>
			new Response("not found", {
				status: 404,
				headers: { "Content-Type": "text/plain" },
			})) as unknown as typeof fetch;

		await expect(
			githubREST("t", "/repos/x/y", { method: "GET" }, fakeFetch),
		).rejects.toThrow();
	});
});
