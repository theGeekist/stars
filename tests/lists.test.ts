import { describe, it, expect } from "bun:test";
import { getAllLists } from "../src/lib/lists.js";

// Smoke test (skipped by default unless token present)
describe("getAllLists", () => {
  it("fetches lists when token exists", async () => {
    if (!Bun.env.GITHUB_TOKEN) {
      return; // skip silently in CI without secret
    }
    const lists = await getAllLists(Bun.env.GITHUB_TOKEN);
    expect(Array.isArray(lists)).toBe(true);
  });
});
