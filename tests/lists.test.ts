import { describe, it, expect } from "bun:test";
import { getAllLists } from "../src/lib/lists.js";

// Smoke test (skipped by default unless token present)
const ALLOW_NETWORK = Bun.env.ALLOW_NETWORK === "1";

describe(
	ALLOW_NETWORK ? "getAllLists" : "getAllLists (skipped: no network)",
	() => {
		it("fetches lists when token exists", async () => {
			if (!ALLOW_NETWORK) return; // skip when network not explicitly allowed
			if (!Bun.env.GITHUB_TOKEN) return; // skip if no token
			const lists = await getAllLists(Bun.env.GITHUB_TOKEN);
			expect(Array.isArray(lists)).toBe(true);
		});
	},
);
