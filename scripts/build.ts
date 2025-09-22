import {
	mkdirSync,
	cpSync,
	readdirSync,
	statSync,
	readFileSync,
	writeFileSync,
} from "fs";
import { join, basename } from "path";

async function main() {
	// Base entrypoints
	const entrypoints = ["src/index.ts", "src/cli.ts"];
	// Discover all public API modules (src/api/*.public.ts) and add them as entry points
	const apiDir = "src/api";
	const publicApis = readdirSync(apiDir)
		.filter((f) => f.endsWith(".public.ts"))
		.map((f) => join(apiDir, f));
	for (const p of publicApis) {
		if (!entrypoints.includes(p)) entrypoints.push(p);
	}
	// Strategy: build heavy root/cli with everything, but externalize LLM core for feature public APIs.
	// Simpler first pass: externalize globally; we can refine if root must include later.
	const result = await Bun.build({
		entrypoints,
		outdir: "dist",
		target: "bun",
		minify: true,
		sourcemap: false,
		external: ["@jasonnathan/llm-core", "ollama"],
	});

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log);
		}
		process.exit(1);
	}

	// Ensure prompts template copied (was handled inline in previous script)
	mkdirSync("dist/features/setup", { recursive: true });
	cpSync(
		"src/features/setup/.prompts.tmpl.yaml",
		"dist/features/setup/.prompts.tmpl.yaml",
	);

	// Add shebang to CLI for proper execution
	const cliPath = "dist/cli.js";
	const cliContent = readFileSync(cliPath, "utf-8");
	if (!cliContent.startsWith("#!/usr/bin/env bun")) {
		writeFileSync(cliPath, `#!/usr/bin/env bun\n${cliContent}`, "utf-8");
	}

	// Report sizes of emitted JS bundles (ignore non-js artifacts)
	console.log("✔ Bundles built (size):");
	for (const e of entrypoints) {
		const outFile = join(
			"dist",
			e
				.replace(/^src\//, "") // strip src/
				.replace(/\.ts$/, ".js"), // ts -> js
		);
		try {
			const st = statSync(outFile);
			const bytes = st.size;
			const pretty =
				bytes < 1024
					? `${bytes} B`
					: bytes < 1024 * 1024
						? `${(bytes / 1024).toFixed(2)} KB`
						: `${(bytes / 1024 / 1024).toFixed(2)} MB`;
			console.log(
				`   • ${basename(outFile).padEnd(24)} ${pretty.padStart(10)} (${bytes} bytes)`,
			);
		} catch {
			console.log(`   • ${basename(outFile)} (missing)`);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
