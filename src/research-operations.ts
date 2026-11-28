import { resolve } from "node:path";

export const OPERATION_NAMES = [
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
] as const;

export type ResearchOperation = (typeof OPERATION_NAMES)[number];

export type OperationInput = Record<string, string | number | boolean>;

export interface OperationJob {
	id: number;
	operation: ResearchOperation;
	state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	startedAt: string;
	finishedAt?: string;
	result?: string;
	error?: string;
	output?: string;
	process: ReturnType<typeof Bun.spawn>;
}

const MAX_OUTPUT_BYTES = 48_000;
const MAX_RETAINED_JOBS = 40;
const LOCK_PATH =
	Bun.env.STARS_RUN_LOCK ??
	resolve(
		Bun.env.HOME ?? "/home/jasonjn",
		".local/state/geekist-stars/run.lock",
	);
const RUNNER_PATH = resolve(
	import.meta.dir,
	"../scripts/research-operation-runner.ts",
);
const jobs = new Map<number, OperationJob>();

function invalid(message: string): never {
	throw new Error(message);
}

function objectInput(value: unknown): Record<string, unknown> {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid("Operation arguments must be a JSON object.");
	return value as Record<string, unknown>;
}

function rejectUnknown(
	input: Record<string, unknown>,
	allowed: string[],
): void {
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key)) invalid(`Unknown operation argument: ${key}`);
	}
}

function boundedString(
	input: Record<string, unknown>,
	key: string,
	max: number,
	required = false,
): string | undefined {
	const value = input[key];
	if (value === undefined && !required) return undefined;
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > max
	)
		invalid(`${key} must be a non-empty string of at most ${max} characters.`);
	return value.trim();
}

function booleanValue(
	input: Record<string, unknown>,
	key: string,
	defaultValue: boolean,
): boolean {
	const value = input[key];
	if (value === undefined) return defaultValue;
	if (typeof value !== "boolean") invalid(`${key} must be true or false.`);
	return value;
}

function limitValue(input: Record<string, unknown>): number {
	const value = input.limit ?? 50;
	if (
		!Number.isInteger(value) ||
		typeof value !== "number" ||
		value < 1 ||
		value > 100
	)
		invalid("limit must be an integer from 1 to 100.");
	return value;
}

/** Validates the finite MCP operation allowlist and removes arbitrary runtime options. */
export function validateOperationInput(
	operation: string,
	value: unknown,
): { operation: ResearchOperation; args: OperationInput } {
	if (!(OPERATION_NAMES as readonly string[]).includes(operation))
		invalid("Unknown Stars operation.");
	const input = objectInput(value);
	let args: OperationInput = {};
	switch (operation as ResearchOperation) {
		case "stars:lists":
		case "stars:stars":
		case "stars:unlisted":
		case "ingest:all":
		case "ingest:lists":
		case "ingest:unlisted":
		case "topics:enrich":
		case "setup:prompts":
		case "setup:promptsState":
		case "setup:modelConfig":
		case "setup:testModelConnectivity":
			if (Object.keys(input).length) rejectUnknown(input, []);
			break;
		case "setup:updatePrompts":
			rejectUnknown(input, ["forcePlaceholder"]);
			args = {
				forcePlaceholder: booleanValue(input, "forcePlaceholder", false),
			};
			break;
		case "setup:writeModelConfig": {
			rejectUnknown(input, ["model", "host", "clear"]);
			const model = boundedString(input, "model", 200);
			const host = boundedString(input, "host", 500);
			const clear = booleanValue(input, "clear", false);
			if (clear && (model !== undefined || host !== undefined))
				invalid("clear cannot be combined with model or host.");
			if (!clear && model === undefined && host === undefined)
				invalid(
					"Provide model or host, or set clear=true to remove the saved configuration.",
				);
			if (clear) args.clear = true;
			if (model !== undefined) args.model = model;
			if (host !== undefined) {
				let parsed: URL;
				try {
					parsed = new URL(host);
				} catch {
					invalid("host must be an absolute HTTP or HTTPS URL.");
				}
				if (
					!["http:", "https:"].includes(parsed.protocol) ||
					parsed.username ||
					parsed.password
				)
					invalid(
						"host must use HTTP or HTTPS and must not contain embedded credentials.",
					);
				args.host = host;
			}
			break;
		}
		case "stars:listRepos":
			rejectUnknown(input, ["listName"]);
			{
				const listName = boundedString(input, "listName", 200, true);
				if (listName === undefined) invalid("listName is required.");
				args = { listName };
			}
			break;
		case "summaries:all":
		case "ranking:all":
			rejectUnknown(input, ["limit", "dryRun", "resummarise"]);
			args = {
				limit: limitValue(input),
				dry: booleanValue(input, "dryRun", true),
			};
			if (operation === "summaries:all")
				args.resummarise = booleanValue(input, "resummarise", false);
			else if (input.resummarise !== undefined)
				invalid("resummarise is only valid for summaries:all.");
			break;
		case "summaries:one":
		case "ranking:one":
			rejectUnknown(input, ["selector", "dryRun"]);
			{
				const selector = boundedString(input, "selector", 200, true);
				if (selector === undefined) invalid("selector is required.");
				args = {
					selector,
					dry: booleanValue(input, "dryRun", true),
				};
			}
			break;
	}
	return { operation: operation as ResearchOperation, args };
}

function readTail(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
	onChunk?: (text: string) => void,
): Promise<string> {
	return (async () => {
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		const decoder = new TextDecoder();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			onChunk?.(decoder.decode(value, { stream: true }));
			chunks.push(value);
			total += value.length;
			while (total > maxBytes && chunks.length) {
				const removed = chunks.shift();
				if (removed) total -= removed.length;
			}
		}
		const combined = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			combined.set(chunk, offset);
			offset += chunk.length;
		}
		return new TextDecoder().decode(combined);
	})();
}

function boundedResult(raw: string): string {
	try {
		const value: unknown = JSON.parse(raw);
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const record = value as Record<string, unknown>;
			if (Array.isArray(record.items) && record.items.length > 25) {
				return JSON.stringify({
					...record,
					items: record.items.slice(0, 25),
					itemsReturned: 25,
					itemsAvailable: record.items.length,
					truncated: true,
				});
			}
			const serialized = JSON.stringify(record);
			if (new TextEncoder().encode(serialized).length <= MAX_OUTPUT_BYTES)
				return serialized;
			if (Array.isArray(record.items)) {
				for (
					let count = Math.min(record.items.length, 25);
					count >= 0;
					count--
				) {
					const preview = JSON.stringify({
						...record,
						items: record.items.slice(0, count),
						itemsReturned: count,
						itemsAvailable: record.items.length,
						truncated: true,
					});
					if (new TextEncoder().encode(preview).length <= MAX_OUTPUT_BYTES)
						return preview;
				}
			}
		}
	} catch {
		// Preserve non-JSON error output below.
	}
	return JSON.stringify({
		resultOmitted: true,
		message:
			"The operation completed, but its output exceeded the response budget. Use the repository profile or saved research tools for bounded retrieval.",
		outputBytes: new TextEncoder().encode(raw).length,
		maximumBytes: MAX_OUTPUT_BYTES,
	});
}

export function operationRequiresSharedLock(
	operation: ResearchOperation,
	args: OperationInput,
): boolean {
	return (
		operation.startsWith("ingest:") ||
		operation === "topics:enrich" ||
		operation === "setup:updatePrompts" ||
		operation === "setup:writeModelConfig" ||
		((operation.startsWith("summaries:") || operation.startsWith("ranking:")) &&
			args.dry === false)
	);
}

export async function startResearchOperation(
	operation: ResearchOperation,
	args: OperationInput,
): Promise<OperationJob> {
	if ([...jobs.values()].filter((job) => job.state === "running").length >= 8)
		throw new Error(
			"Stars has reached the eight-job limit; check operation status before retrying.",
		);
	const waitsForLock = operationRequiresSharedLock(operation, args);
	const command = waitsForLock
		? [
				"flock",
				"-w",
				"86400",
				"-E",
				"75",
				"--no-fork",
				LOCK_PATH,
				process.execPath,
				"run",
				RUNNER_PATH,
			]
		: [process.execPath, "run", RUNNER_PATH];
	const child = Bun.spawn(command, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...Bun.env,
			STARS_OPERATION: operation,
		},
	});
	const job: OperationJob = {
		id: child.pid,
		operation,
		state: waitsForLock ? "queued" : "running",
		startedAt: new Date().toISOString(),
		process: child,
	};
	jobs.set(job.id, job);
	while (jobs.size > MAX_RETAINED_JOBS) {
		const oldestFinished = [...jobs.values()].find(
			(candidate) => candidate.state !== "running",
		);
		if (!oldestFinished) break;
		jobs.delete(oldestFinished.id);
	}
	const stdoutPromise = readTail(child.stdout, MAX_OUTPUT_BYTES + 1_000);
	const stderrPromise = readTail(child.stderr, 8_000, (chunk) => {
		if (chunk.includes("STARS_OPERATION_STARTED") && job.state === "queued")
			job.state = "running";
	});
	child.stdin.write(JSON.stringify(args));
	child.stdin.end();
	void (async () => {
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			stdoutPromise,
			stderrPromise,
		]);
		job.finishedAt = new Date().toISOString();
		if (job.state === "cancelled") return;
		if (exitCode === 0) {
			job.state = "succeeded";
			job.result = boundedResult(stdout.trim());
			return;
		}
		const waitingForLock = job.state === "queued";
		job.state = "failed";
		job.error =
			exitCode === 75 && waitingForLock
				? "The operation waited 24 hours but the shared Stars run lock remained occupied; the operation did not start."
				: stderr.trim().slice(-2_000) ||
					`Operation process exited with code ${exitCode}.`;
	})();
	return job;
}

export function listResearchOperations(): Array<Omit<OperationJob, "process">> {
	return [...jobs.values()]
		.slice(-20)
		.map(({ process: _process, result: _result, ...job }) => ({ ...job }));
}

export function getResearchOperation(
	id: number,
): Omit<OperationJob, "process"> | undefined {
	const job = jobs.get(id);
	if (!job) return undefined;
	const { process: _process, ...publicJob } = job;
	return { ...publicJob };
}

export function cancelResearchOperation(id: number): boolean {
	const job = jobs.get(id);
	if (!job || (job.state !== "running" && job.state !== "queued")) return false;
	const wasQueued = job.state === "queued";
	job.state = "cancelled";
	job.finishedAt = new Date().toISOString();
	job.process.kill("SIGTERM");
	job.output = wasQueued
		? "Cancelled while waiting for the shared Stars run lock; the operation had not started."
		: "Worker stopped on request; completed writes are not rolled back.";
	return true;
}
