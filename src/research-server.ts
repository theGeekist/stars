import { Database } from "bun:sqlite";
import { handleResearchApi } from "@src/api/research";

const databaseFile = Bun.env.DB_FILE || "repolists.db";
const database = new Database(databaseFile, { readonly: true, create: false });
const port = Number(Bun.env.STARS_API_PORT ?? 8788);

Bun.serve({
	hostname: "127.0.0.1",
	port,
	fetch(request) {
		if (request.method !== "GET")
			return Response.json({ error: "Method not allowed" }, { status: 405 });
		const url = new URL(request.url);
		if (url.pathname === "/health")
			return Response.json({ ok: true, readOnly: true });
		if (!url.pathname.startsWith("/research/"))
			return Response.json({ error: "Not found" }, { status: 404 });
		try {
			const result = handleResearchApi(url, database);
			return result ?? Response.json({ error: "Not found" }, { status: 404 });
		} catch {
			return Response.json({ error: "Research query failed" }, { status: 400 });
		}
	},
});

console.error(`Stars read-only research API listening on 127.0.0.1:${port}`);
