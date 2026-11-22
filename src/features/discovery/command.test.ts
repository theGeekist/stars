import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

describe("discovery command isolation", () => {
	it("opens only the explicitly selected database and closes it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "stars-discovery-"));
		try {
			const target = join(dir, "target.db");
			const sentinel = join(dir, "sentinel.db");
			new Database(target).close();
			const other = new Database(sentinel);
			other.exec(
				"CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('untouched')",
			);
			other.close();
			const before = readFileSync(sentinel);
			writeFileSync(join(dir, "index.json"), "[]");
			writeFileSync(join(dir, "unlisted.json"), "[]");
			const script = resolve(import.meta.dir, "../../../scripts/discover.ts");
			const child = Bun.spawn(
				[process.execPath, "run", script, "--db", target, "--exports", dir],
				{
					cwd: dir,
					env: {
						...process.env,
						DB_FILE: sentinel,
						GITHUB_TOKEN: "test-token",
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const stderr = await new Response(child.stderr).text();
			expect({ code: await child.exited, stderr }).toEqual({
				code: 0,
				stderr: "",
			});
			expect(readFileSync(sentinel).equals(before)).toBe(true);
			const check = new Database(target, { readonly: true });
			try {
				expect(check.query("SELECT * FROM discovery_target").all()).toEqual([]);
			} finally {
				check.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("closes the selected database when schema initialization fails", async () => {
		const dir = mkdtempSync(join(tmpdir(), "stars-discovery-failure-"));
		try {
			const target = join(dir, "broken.db");
			const db = new Database(target);
			db.exec("CREATE TABLE repo (id INTEGER PRIMARY KEY)");
			db.close();
			writeFileSync(join(dir, "index.json"), "[]");
			writeFileSync(join(dir, "unlisted.json"), "[]");
			const script = resolve(import.meta.dir, "../../../scripts/discover.ts");
			const child = Bun.spawn(
				[process.execPath, "run", script, "--db", target, "--exports", dir],
				{
					cwd: dir,
					env: { ...process.env, GITHUB_TOKEN: "test-token" },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			await new Response(child.stdout).text();
			await new Response(child.stderr).text();
			expect(await child.exited).toBe(1);
			const check = new Database(target);
			try {
				expect(check.query("SELECT COUNT(*) AS n FROM repo").get()).toEqual({
					n: 0,
				});
			} finally {
				check.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
