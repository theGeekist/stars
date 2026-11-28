import { Database } from "bun:sqlite";
import { handleResearchApi } from "@src/api/research";
import {
	cancelResearchOperation,
	getResearchOperation,
	listResearchOperations,
	startResearchOperation,
	validateOperationInput,
} from "@src/research-operations";

const databaseFile = Bun.env.DB_FILE || "repolists.db";
const database = new Database(databaseFile, { readonly: true, create: false });
const port = Number(Bun.env.STARS_API_PORT ?? 8788);

Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(request) {
		const url = new URL(request.url);
		const postRoute =
			url.pathname === "/operations" ||
			/^\/operations\/jobs\/\d+\/cancel$/.test(url.pathname);
		if (request.method !== "GET" && request.method !== "POST")
			return Response.json({ error: "Method not allowed" }, { status: 405 });
		if (request.method === "POST" && !postRoute)
			return Response.json({ error: "Method not allowed" }, { status: 405 });
		if (url.pathname === "/health")
			return Response.json({
				ok: true,
				researchQueriesReadOnly: true,
				operationToolsEnabled: true,
			});
		if (url.pathname === "/operations") {
			if (request.method !== "POST")
				return Response.json({ error: "Method not allowed" }, { status: 405 });
			try {
				const operation = url.searchParams.get("name") ?? "";
				const body = await request.text();
				if (new TextEncoder().encode(body).length > 16_000)
					return Response.json(
						{ error: "Operation request too large" },
						{ status: 413 },
					);
				const input = body ? JSON.parse(body) : {};
				const validated = validateOperationInput(operation, input);
				const job = await startResearchOperation(
					validated.operation,
					validated.args,
				);
				return Response.json(
					{
						id: job.id,
						operation: job.operation,
						state: job.state,
						startedAt: job.startedAt,
						poll: `/operations/jobs/${job.id}`,
					},
					{ status: 202 },
				);
			} catch (error) {
				return Response.json(
					{
						error: "Invalid operation request",
						message: error instanceof Error ? error.message : String(error),
					},
					{ status: 400 },
				);
			}
		}
		if (url.pathname === "/operations/jobs")
			return Response.json({ jobs: listResearchOperations() });
		const jobMatch = url.pathname.match(
			/^\/operations\/jobs\/(\d+)(\/cancel)?$/,
		);
		if (jobMatch) {
			const id = Number(jobMatch[1]);
			if (jobMatch[2]) {
				if (request.method !== "POST")
					return Response.json(
						{ error: "Method not allowed" },
						{ status: 405 },
					);
				const cancelled = cancelResearchOperation(id);
				return Response.json(
					cancelled
						? { ok: true, id, state: "cancelled" }
						: { error: "Operation is not running" },
					{ status: cancelled ? 200 : 409 },
				);
			}
			const job = getResearchOperation(id);
			return job
				? Response.json(job)
				: Response.json({ error: "Unknown operation id" }, { status: 404 });
		}
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

console.error(
	`Stars research and typed operation API listening on 127.0.0.1:${port}`,
);
