import { dispatchCommand, type DispatchKind } from "../src/api/dispatch";
import { enrichAllRepoTopics } from "../src/api/topics";
import * as setup from "../src/api/setup.public";
import type { ResearchOperation } from "../src/research-operations";

const operation = Bun.env.STARS_OPERATION as ResearchOperation | undefined;
const allowed: ResearchOperation[] = [
	"stars:lists",
	"stars:listRepos",
	"stars:stars",
	"stars:unlisted",
	"ingest:all",
	"ingest:lists",
	"ingest:unlisted",
	"summaries:all",
	"summaries:one",
	"ranking:all",
	"ranking:one",
	"topics:enrich",
	"setup:prompts",
	"setup:promptsState",
	"setup:updatePrompts",
	"setup:modelConfig",
	"setup:writeModelConfig",
	"setup:testModelConnectivity",
];

if (!operation || !allowed.includes(operation)) {
	console.error("Unknown Stars operation.");
	process.exitCode = 2;
} else {
	const input = await new Response(Bun.stdin.stream()).text();
	const args = JSON.parse(input) as Record<string, string | number | boolean>;
	if (!Bun.env.GITHUB_TOKEN) {
		const auth = Bun.spawnSync(["gh", "auth", "token"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		if (auth.exitCode === 0) {
			const token = auth.stdout.toString().trim();
			if (token) Bun.env.GITHUB_TOKEN = token;
		}
	}
	console.error("STARS_OPERATION_STARTED");
	try {
		let result: unknown;
		switch (operation) {
			case "topics:enrich":
				result = await enrichAllRepoTopics();
				break;
			case "setup:prompts":
				result = setup.getPrompts();
				break;
			case "setup:promptsState":
				result = setup.getPromptsState();
				break;
			case "setup:updatePrompts":
				result = await setup.updatePromptsFromTemplate(
					Bun.env.GITHUB_TOKEN ?? "",
					{ forcePlaceholder: args.forcePlaceholder === true },
				);
				break;
			case "setup:modelConfig":
				result = setup.readModelConfig();
				break;
			case "setup:writeModelConfig":
				result = setup.writeModelConfig(
					args.clear === true
						? {}
						: {
								model: typeof args.model === "string" ? args.model : undefined,
								host: typeof args.host === "string" ? args.host : undefined,
							},
				);
				break;
			case "setup:testModelConnectivity":
				result = await setup.testModelConnectivity();
				break;
			default:
				result = await dispatchCommand(
					operation as DispatchKind,
					{ args } as never,
				);
		}
		if (result === undefined) result = { ok: true };
		if (result && typeof result === "object" && !Array.isArray(result)) {
			const record = result as Record<string, unknown>;
			if (Array.isArray(record.items) && record.items.length > 25) {
				result = {
					...record,
					items: record.items.slice(0, 25),
					itemsReturned: 25,
					itemsAvailable: record.items.length,
					truncated: true,
				};
			}
		}
		const output = JSON.stringify(result);
		if (new TextEncoder().encode(output).length > 48_000) {
			process.stdout.write(
				JSON.stringify({
					resultOmitted: true,
					message:
						"The operation completed, but its output exceeded the result budget.",
					outputBytes: new TextEncoder().encode(output).length,
				}),
			);
		} else {
			process.stdout.write(output);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
