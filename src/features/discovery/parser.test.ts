import { describe, expect, it } from "bun:test";
import { extractMarkdownMentions } from "./parser";

describe("collection Markdown extraction", () => {
	it("keeps table roles, sections, locations, subpaths and external resources", () => {
		const mentions = extractMarkdownMentions(
			`# Cookbooks\n\n| Repository | User | Website |\n| --- | --- | --- |\n| [Cookbook](https://github.com/a/recipes/tree/main/cook) | [Alice](https://github.com/alice) | [Recipes](https://example.org/food) |\n`,
			"https://github.com/source/list/blob/abc/README.md",
		);
		expect(mentions.map((m) => [m.url, m.role, m.column, m.line])).toEqual([
			["https://github.com/a/recipes/tree/main/cook", "item", "Repository", 5],
			["https://github.com/alice", "author", "User", 5],
			["https://example.org/food", "item", "Website", 5],
		]);
		expect(mentions[0].section).toEqual(["Cookbooks"]);
		expect(mentions[0].context).toContain("Alice");
		expect(mentions[0].related_links).toContainEqual({
			url: "https://github.com/alice",
			label: "Alice",
			column: "User",
			role: "author",
		});
	});
	it("resolves reference links and nested list items without duplicating them", () => {
		const mentions = extractMarkdownMentions(
			`# Things\n- [One][one]\n  - [Two](../two)\n\n[one]: https://example.org/one\n`,
			"https://example.org/a/readme.md",
		);
		expect(mentions.map((m) => m.url)).toEqual([
			"https://example.org/one",
			"https://example.org/two",
		]);
	});
});
