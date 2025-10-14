import {
        existsSync,
        mkdirSync,
        readdirSync,
        renameSync,
        rmSync,
        writeFileSync,
} from "node:fs";
import { join } from "node:path";

const textDecoder = new TextDecoder();
const SAFE_BIN_DIRS = ["/bin", "/usr/bin", "/sbin", "/usr/sbin"] as const;
const SAFE_PATH = SAFE_BIN_DIRS.join(":");

function isUnderSafeDir(path: string): boolean {
        return SAFE_BIN_DIRS.some((dir) => path.startsWith(`${dir}/`) || path === dir);
}

function resolveSafeExecutable(name: string): string {
        const candidate = Bun.which(name);
        if (candidate && isUnderSafeDir(candidate)) {
                return candidate;
        }
        for (const dir of SAFE_BIN_DIRS) {
                const fallback = `${dir}/${name}`;
                if (existsSync(fallback)) return fallback;
        }
        console.error(`Unable to locate trusted executable for ${name}`);
        process.exit(1);
}

const bunCmd = Bun.which("bun") ?? process.argv[0];
if (!bunCmd) {
        console.error("Unable to locate bun executable");
        process.exit(1);
}
const findCmd = resolveSafeExecutable("find");

const safeEnv = { ...process.env, PATH: SAFE_PATH } as Record<string, string>;

type StdIO = "inherit" | "ignore" | "pipe";

function spawnOrExit(
        cmd: string[],
        opts: { stdout?: StdIO; stdin?: StdIO } = {},
) {
        const res = Bun.spawnSync({
                cmd,
                stdout: opts.stdout ?? "inherit",
                stderr: "inherit",
                stdin: opts.stdin ?? "inherit",
                env: safeEnv,
        });
        if (res.exitCode !== 0) {
                process.exit(res.exitCode ?? 1);
        }
        return res;
}

function run(cmd: string[]): void {
        spawnOrExit(cmd, { stdin: "inherit", stdout: "inherit" });
}

function runCapture(cmd: string[]): string {
        const res = spawnOrExit(cmd, { stdin: "ignore", stdout: "pipe" });
        return res.stdout ? textDecoder.decode(res.stdout) : "";
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
const findOutput = runCapture([
        findCmd,
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
        run([bunCmd, "test", file]);
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

const merge = spawnOrExit(
        [bunCmd, "x", "--bun", "lcov-result-merger", ...collected],
        { stdin: "ignore", stdout: "pipe" },
);
const mergedOutput = merge.stdout ? textDecoder.decode(merge.stdout) : "";
writeFileSync(mainLcov, mergedOutput);
