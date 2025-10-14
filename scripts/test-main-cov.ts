import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

function run(command: string, args: string[], inherit = true): void {
	const res = spawnSync(command, args, {
		stdio: inherit ? "inherit" : ["ignore", "pipe", "inherit"],
	});
	if (res.status !== 0) {
		const code = res.status ?? 1;
		process.exit(code);
	}
}

function runCapture(command: string, args: string[]): string {
	const res = spawnSync(command, args, {
		stdio: ["ignore", "pipe", "inherit"],
	});
	if (res.status !== 0) {
		const code = res.status ?? 1;
		process.exit(code);
	}
	return res.stdout?.toString("utf-8") ?? "";
}

const root = process.cwd();
const coverageDir = join(root, "coverage");
if (!existsSync(coverageDir)) {
	mkdirSync(coverageDir);
}

// Clean previous main coverage artifacts
for (const file of readdirSync(coverageDir)) {
	if (file.startsWith("main-") && file.endsWith(".info")) {
		rmSync(join(coverageDir, file));
	}
}
const mainLcov = join(coverageDir, "main-lcov.info");
if (existsSync(mainLcov)) {
	rmSync(mainLcov);
}

// Find main test files (excluding cli + lib tests handled elsewhere)
const findOutput = runCapture("find", [
	"src",
	"-name",
	"*.test.ts",
	"!",
	"-name",
	"cli.handlers.test.ts",
	"!",
	"-name",
	"cli.routing.test.ts",
	"!",
	"-path",
	"*/lib/*",
]);
const testFiles = findOutput
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean)
	.sort();

const collected: string[] = [];

testFiles.forEach((file, index) => {
	run("bun", ["test", file]);
	const lcovPath = join(coverageDir, "lcov.info");
	if (!existsSync(lcovPath)) {
		console.error(`Expected coverage output at ${lcovPath} after ${file}`);
		process.exit(1);
	}
	const dest = join(
		coverageDir,
		`main-${String(index + 1).padStart(3, "0")}.info`,
	);
	renameSync(lcovPath, dest);
	collected.push(dest);
});

if (collected.length === 0) {
	writeFileSync(mainLcov, "");
	process.exit(0);
}

const merge = spawnSync("npx", ["-y", "lcov-result-merger", ...collected], {
	stdio: ["ignore", "pipe", "inherit"],
});
if (merge.status !== 0) {
	const code = merge.status ?? 1;
	process.exit(code);
}
writeFileSync(mainLcov, merge.stdout?.toString("utf-8") ?? "");
