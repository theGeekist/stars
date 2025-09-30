#!/usr/bin/env bun

/**
 * Local Codecov Test Script
 * Tests codecov upload functionality locally
 */

import { $ } from "bun";
import { existsSync } from "fs";

async function testCodecovUpload() {
	console.log("🧪 Testing Codecov Upload Locally\n");

	const lcovPath = "./coverage/lcov.info";

	if (!existsSync(lcovPath)) {
		console.log("❌ coverage/lcov.info not found. Run: bun run coverage:ci");
		process.exit(1);
	}

	console.log("✅ Found coverage/lcov.info");

	// Check if codecov CLI is available
	try {
		await $`codecov --version`.quiet();
		console.log("✅ Codecov CLI available");
	} catch {
		console.log("⚠️  Codecov CLI not found, installing...");
		try {
			await $`npm install -g codecov`;
			console.log("✅ Codecov CLI installed");
		} catch (error) {
			console.log("❌ Failed to install codecov CLI:", error);
			process.exit(1);
		}
	}

	// Test upload (dry run)
	console.log("\n🚀 Testing upload (dry run)...");
	try {
		const result = await $`codecov --file coverage/lcov.info --dry-run`.text();
		console.log("📤 Dry run output:");
		console.log(result);
		console.log("\n✅ Dry run successful!");
	} catch (error) {
		console.log("❌ Dry run failed:", error);
	}

	console.log("\n💡 Next steps:");
	console.log("  1. Ensure CODECOV_TOKEN is set in GitHub repository secrets");
	console.log("  2. Push changes to trigger CI and test actual upload");
	console.log("  3. Check codecov.io dashboard for results");
}

if (import.meta.main) {
	testCodecovUpload().catch(console.error);
}
