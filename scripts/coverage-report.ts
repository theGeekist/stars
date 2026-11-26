#!/usr/bin/env bun

/**
 * Comprehensive Coverage Reporting Script
 * - Generates an HTML report from unified coverage
 * - Creates consolidated coverage summary
 * - Provides codecov-compatible output
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const COVERAGE_DIR = "./coverage";
const HTML_DIR = `${COVERAGE_DIR}/html`;

interface CoverageStats {
	name: string;
	functions: { hit: number; found: number; percent: number };
	lines: { hit: number; found: number; percent: number };
	branches?: { hit: number; found: number; percent: number };
}

async function ensureDirectories() {
	if (!existsSync(HTML_DIR)) mkdirSync(HTML_DIR, { recursive: true });
}

async function generateConsolidatedReport() {
	console.log("\n📈 Generating consolidated coverage report...");

	if (existsSync(`${COVERAGE_DIR}/lcov.info`)) {
		try {
			await $`genhtml ${COVERAGE_DIR}/lcov.info --output-directory ${HTML_DIR} --title "Geekist Stars - Unified Coverage" --function-coverage --branch-coverage --demangle-cpp --quiet`.quiet();
			console.log("  ✅ Unified HTML report generated");
		} catch (error) {
			console.log(
				"  ⚠️  Consolidated report failed, trying basic generation...",
			);
			try {
				await $`genhtml ${COVERAGE_DIR}/lcov.info --output-directory ${HTML_DIR} --title "Geekist Stars - Unified Coverage" --quiet`.quiet();
				console.log("  ✅ Unified HTML report generated (basic)");
			} catch (fallbackError) {
				console.log(`  ❌ Consolidated report failed: ${fallbackError}`);
			}
		}
	} else {
		console.log("  ⚠️  lcov.info not found - run coverage:ci first");
	}
}

async function parseLcovSummary(
	filePath: string,
): Promise<CoverageStats | null> {
	if (!existsSync(filePath)) return null;

	try {
		// Parse LCOV file directly instead of using lcov command
		const content = await Bun.file(filePath).text();
		const lines = content.split("\n");

		let functions = { hit: 0, found: 0, percent: 0 };
		let linesCov = { hit: 0, found: 0, percent: 0 };

		let totalFunctionsFound = 0;
		let totalFunctionsHit = 0;
		let totalLinesFound = 0;
		let totalLinesHit = 0;

		for (const line of lines) {
			if (line.startsWith("FNF:")) {
				totalFunctionsFound += parseInt(line.split(":")[1]) || 0;
			} else if (line.startsWith("FNH:")) {
				totalFunctionsHit += parseInt(line.split(":")[1]) || 0;
			} else if (line.startsWith("LF:")) {
				totalLinesFound += parseInt(line.split(":")[1]) || 0;
			} else if (line.startsWith("LH:")) {
				totalLinesHit += parseInt(line.split(":")[1]) || 0;
			}
		}

		functions = {
			hit: totalFunctionsHit,
			found: totalFunctionsFound,
			percent:
				totalFunctionsFound > 0
					? (totalFunctionsHit / totalFunctionsFound) * 100
					: 0,
		};

		linesCov = {
			hit: totalLinesHit,
			found: totalLinesFound,
			percent:
				totalLinesFound > 0 ? (totalLinesHit / totalLinesFound) * 100 : 0,
		};

		return {
			name: path.basename(filePath, ".info"),
			functions,
			lines: linesCov,
		};
	} catch (error) {
		console.log(`  ⚠️  Error parsing ${filePath}: ${error}`);
		return null;
	}
}

async function generateSummaryReport() {
	console.log("\n📋 Coverage Summary:");
	console.log("─".repeat(80));

	const coverageFiles = [
		{ name: "Unified Test Run", file: `${COVERAGE_DIR}/lcov.info` },
	];

	if (!existsSync(`${COVERAGE_DIR}/lcov.info`)) {
		console.log(
			"  ⚠️  No coverage artefacts found. Run `bun run coverage:ci` (which now just calls `bun test`) first.",
		);
		return;
	}

	console.log("Test Run          Functions        Lines           ");
	console.log("─".repeat(80));

	for (const { name, file } of coverageFiles) {
		const stats = await parseLcovSummary(file);
		if (stats) {
			const funcStr = `${stats.functions.hit}/${stats.functions.found} (${stats.functions.percent.toFixed(1)}%)`;
			const linesStr = `${stats.lines.hit}/${stats.lines.found} (${stats.lines.percent.toFixed(1)}%)`;
			console.log(
				`${name.padEnd(16)} ${funcStr.padEnd(15)} ${linesStr.padEnd(15)}`,
			);
		} else {
			console.log(
				`${name.padEnd(16)} ${"Not found".padEnd(15)} ${"Not found".padEnd(15)}`,
			);
		}
	}

	console.log("─".repeat(80));
}

function printAccessInfo() {
	console.log("\n🌐 Coverage Reports Available:");
	console.log(`  📊 Unified: file://${path.resolve(HTML_DIR)}/index.html`);
	console.log("");
	console.log(
		"💡 Tip: Open these in your browser for detailed line-by-line coverage",
	);
}

async function validateCodecovFormat() {
	console.log("\n🔍 Codecov Validation:");

	const lcovPath = `${COVERAGE_DIR}/lcov.info`;
	if (!existsSync(lcovPath)) {
		console.log("  ❌ lcov.info not found");
		return;
	}

	try {
		const content = await Bun.file(lcovPath).text();
		const lines = content.split("\n");

		const sfCount = lines.filter((line) => line.startsWith("SF:")).length;
		const recordCount = lines.filter((line) => line === "end_of_record").length;
		const hasValidPaths = lines.some((line) => line.startsWith("SF:src/"));

		console.log(`  📁 Source files: ${sfCount}`);
		console.log(`  📊 Records: ${recordCount}`);
		console.log(`  ✅ Valid paths: ${hasValidPaths ? "Yes" : "No"}`);
		console.log(`  📦 File size: ${(content.length / 1024).toFixed(1)}KB`);

		if (sfCount === recordCount && hasValidPaths) {
			console.log("  🎉 Codecov format looks good!");
		} else {
			console.log("  ⚠️  Potential codecov issues detected");
		}

		// Additional codecov debugging info
		console.log("\n💡 Codecov Troubleshooting:");
		console.log("  • Make sure CODECOV_TOKEN is set in GitHub secrets");
		console.log("  • Verify CI uploads after coverage:ci step completes");
		console.log("  • Check codecov.yml is properly configured");
		console.log("  • Coverage may take a few minutes to appear on codecov.io");
		console.log(
			'  • Previous "unknown" status suggests token or config issues',
		);
	} catch (error) {
		console.log(`  ❌ Error reading lcov.info: ${error}`);
	}
}

async function main() {
	console.log("🚀 Geekist Stars Coverage Report Generator\n");

	await ensureDirectories();
	await generateConsolidatedReport();
	await generateSummaryReport();
	await validateCodecovFormat();
	printAccessInfo();

	console.log("\n✨ Coverage reporting complete!");
}

if (import.meta.main) {
	main().catch(console.error);
}
