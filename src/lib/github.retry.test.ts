import { describe, expect, it } from "bun:test";
import { githubGraphQL, githubREST, gql } from "./github";
import type { FetchLike } from "./types";

describe("github retry behavior", () => {
	it("githubREST retries on 5xx then succeeds", async () => {
		const calls: Array<{ url: string; method?: string }> = [];
		let n = 0;
		const fake: typeof fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({ url: String(input), method: init?.method });
			n++;
			if (n === 1) return new Response("oops", { status: 500 });
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		const res = await githubREST<{ ok: boolean }>("t", "/rate_limit", {}, fake);
		expect(res.ok).toBeTrue();
		expect(calls.length).toBe(2);
		expect(calls[0].url).toContain("https://api.github.com/rate_limit");
	});

	it("githubGraphQL retries on 403 then succeeds", async () => {
		const calls: Array<{ url: string; body?: string }> = [];
		let n = 0;
		const fake: FetchLike = async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({ url: String(input), body: String(init?.body ?? "") });
			n++;
			if (n === 1) return new Response("forbidden", { status: 403 });
			return new Response(JSON.stringify({ data: { ok: true } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const query = gql`query { viewer { login } }`;
		const out = await githubGraphQL<{ ok: boolean }>("t", query, {}, fake);
		expect(out.ok).toBeTrue();
		expect(calls.length).toBe(2);
		expect(calls[0].url).toContain("https://api.github.com/graphql");
	});
});
