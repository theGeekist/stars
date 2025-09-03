import { describe, it } from "bun:test";
import { _testMain } from "@src/cli";

describe("cli routing smoke coverage", () => {
	it("help path runs", async () => {
		await _testMain(["bun", "cli.ts", "help"]);
	});

	it("topics:report --json runs", async () => {
		await _testMain(["bun", "cli.ts", "topics:report", "--json"]);
	});
});
