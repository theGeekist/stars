import { describe, expect, it } from "bun:test";
import { createDb } from "@lib/db";
import { createProvenanceService } from "./provenance";

describe("source discovery provenance", () => {
	it("preserves recovery metadata and records idempotent, independently sourced observations", () => {
		const db = createDb();
		try {
			db.query(
				"INSERT INTO recovery_provenance(source,details_json) VALUES (?,?)",
			).run("github", JSON.stringify({ complete: true }));
			const service = createProvenanceService({ db });
			const first = {
				target: "https://github.com/a/cookbook",
				context_topics: ["food"],
				path: "README.md",
				revision: "one",
				line: 21,
			};
			expect(service.record("github", first)).toBe(true);
			expect(
				service.record("github", {
					line: 21,
					revision: "one",
					path: "README.md",
					context_topics: ["food"],
					target: first.target,
				}),
			).toBe(false);
			expect(service.record("github", { ...first, revision: "two" })).toBe(
				true,
			);
			expect(
				service.record("https://example.org/list", {
					target: first.target,
					context_topics: ["history"],
				}),
			).toBe(true);
			expect(service.forSource("github")).toHaveLength(2);
			expect(service.forTarget(first.target)).toHaveLength(3);
			expect(service.forTopic("food")).toHaveLength(2);
			expect(service.forTopic("history")).toHaveLength(1);
			expect(service.forTopic("missing")).toEqual([]);
			const row = db
				.query<{ details_json: string }, [string]>(
					"SELECT details_json FROM recovery_provenance WHERE source=?",
				)
				.get("github");
			expect(JSON.parse(row?.details_json ?? "{}").complete).toBe(true);
			expect(service.forSource("missing")).toEqual([]);
		} finally {
			db.close();
		}
	});

	it("does not replace incompatible pre-existing metadata", () => {
		const db = createDb();
		try {
			db.query("INSERT INTO recovery_provenance VALUES (?,?)").run(
				"source",
				JSON.stringify({ discovery_observations: "keep me", other: 3 }),
			);
			const service = createProvenanceService({ db });
			expect(() => service.record("source", { target: "item" })).toThrow();
			const row = db
				.query<{ details_json: string }, [string]>(
					"SELECT details_json FROM recovery_provenance WHERE source=?",
				)
				.get("source");
			expect(JSON.parse(row?.details_json ?? "{}")).toEqual({
				discovery_observations: "keep me",
				other: 3,
			});
		} finally {
			db.close();
		}
	});
});
