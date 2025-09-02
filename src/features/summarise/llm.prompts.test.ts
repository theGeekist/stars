import { describe, expect, it } from "bun:test";
import { summariseRepoOneParagraph } from "./llm";

describe("summarise llm prompts integration", () => {
	it("short-circuits awesome lists without network", async () => {
		const text = await summariseRepoOneParagraph({
			nameWithOwner: "o/awesome",
			url: "u",
			topics: ["awesome"],
		});
		expect(typeof text).toBe("string");
		expect(text.toLowerCase()).toContain("curated");
	});
});
