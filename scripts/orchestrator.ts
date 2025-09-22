/**
 * scripts/orchestrator.ts
 * Minimal Bun-native sequential runner.
 * - Runs your CLI subcommands one after another
 * - Streams stdout/stderr to per-step log files
 * - No timeouts, no retries, no abstractions
 * - Optional --only / --skip filters
 */

const ROOT = new URL("..", import.meta.url).pathname; // repo root (../ from ./scripts)
const LOG_DIR = `${ROOT}/logs`;
const STEP_LOG_DIR = `${LOG_DIR}/steps`;
const GH_EXPLORE_DIR = "/Users/jasonnathan/Repos/gh_explore"; // adjust if needed

const onlyArg = Bun.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const skipArg = Bun.argv.find((a) => a.startsWith("--skip="))?.split("=")[1];
const only = new Set((onlyArg ?? "").split(",").filter(Boolean));
const skip = new Set((skipArg ?? "").split(",").filter(Boolean));

const PATH = `${Bun.env.HOME}/.bun/bin:${Bun.env.PATH ?? ""}`;
const env = { ...Bun.env, PATH };

// Define steps as full commands (no indirection). For bun: bun run src/cli.ts <task>
// Note: score step uses --respect-curation by default to preserve manual list curation
type Step = { name: string; cmd: string[] };

const steps: Step[] = [
	{ name: "lists", cmd: ["bun", "run", "src/cli.ts", "lists"] },
	{ name: "unlisted", cmd: ["bun", "run", "src/cli.ts", "unlisted"] },
	{ name: "ingest", cmd: ["bun", "run", "src/cli.ts", "ingest"] },
	{ name: "git-pull", cmd: ["git", "-C", GH_EXPLORE_DIR, "pull", "--ff-only"] },
	{ name: "topics-enrich", cmd: ["bun", "run", "src/cli.ts", "topics:enrich"] },
	{ name: "summarise", cmd: ["bun", "run", "src/cli.ts", "summarise"] },
	{
		name: "score",
		cmd: ["bun", "run", "src/cli.ts", "score", "--respect-curation"],
	},
];

function now() {
	return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// Pipe a readable stream into a Bun file writer (append), and also mirror to console
async function pipe(
	readable: ReadableStream<Uint8Array> | null,
	filePath: string,
) {
	if (!readable) return;
	const writer = Bun.file(filePath).writer();
	try {
		for await (const chunk of readable) {
			writer.write(chunk);
			// mirror raw chunk to console without extra timestamps (keeps CLI output familiar)
			Bun.write(Bun.stdout, chunk).catch(() => {});
		}
		await writer.flush();
	} finally {
		await writer.end();
	}
}

async function runStep({ name, cmd }: Step) {
	if (only.size && !only.has(name)) {
		console.log(`[${now()}] skip ${name} (not in --only)`);
		return;
	}
	if (skip.has(name)) {
		console.log(`[${now()}] skip ${name} (--skip)`);
		return;
	}

	const outPath = `${STEP_LOG_DIR}/${name}.out.log`;
	const outSink = Bun.file(outPath).writer();
	const errPath = `${STEP_LOG_DIR}/${name}.err.log`;
	const errSink = Bun.file(errPath).writer();

	// Mark start of step in both logs
	const banner = `\n[${now()}] ▶ ${name} starting: ${cmd.join(" ")}\n`;
	outSink.write(banner);
	errSink.write(banner);

	const proc = Bun.spawn(cmd, {
		cwd: ROOT,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});

	// Stream stdout/stderr directly to files (and console)
	const pump = Promise.all([
		pipe(proc.stdout, outPath),
		pipe(proc.stderr, errPath),
	]);

	const code = await proc.exited; // wait until done (no timeout)
	await pump;

	const footer = `[${now()}] ${code === 0 ? "✓" : "✗"} ${name} ${code === 0 ? "done" : `failed (exit ${code})`}\n`;
	outSink.write(footer);
	outSink.flush();
	outSink.end();
	if (code !== 0) {
		errSink.write(footer);
		errSink.flush();
		return errSink.end(new Error(`${name} failed (exit ${code})`));
	}
	await errSink.flush();
}

(async () => {
	console.log(`[${now()}] Starting pipeline…`);
	for (const s of steps) {
		console.log(`[${now()}] → ${s.name}`);
		await runStep(s);
	}
	console.log(`[${now()}] Pipeline complete ✅`);
})().catch(async (err) => {
	const msg = `[${now()}] Pipeline aborted: ${(err as Error).message}\n`;
	await Bun.write(`${LOG_DIR}/orchestrator.err.log`, msg);
	console.error(msg.trimEnd());
	process.exit(1);
});
