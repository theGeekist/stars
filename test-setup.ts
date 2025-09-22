// test-setup.ts
// This file is preloaded before running tests to ensure clean mock state

import { mock, beforeEach, afterEach } from "bun:test";

// Clear all mocks before each test file
beforeEach(() => {
	mock.clearAllMocks();
});

// Ensure a clean module cache between test files
// This helps prevent module mock contamination
if (typeof global !== "undefined") {
	// Store original module loader for cleanup
	const originalRequire = global.require;

	afterEach(() => {
		// Reset require cache to prevent module contamination
		if (global.require && global.require.cache) {
			Object.keys(global.require.cache).forEach((key) => {
				delete global.require.cache[key];
			});
		}
	});
}
