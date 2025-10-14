// test-setup.ts
// Centralised hooks to isolate tests when running the full suite together.

import { afterEach, beforeEach, jest } from "bun:test";

const originalEnv = new Map(Object.entries(Bun.env));
const originalCwd = process.cwd();
const originalExit = process.exit;

beforeEach(() => {
	jest.clearAllMocks();
});

afterEach(() => {
	for (const key of Object.keys(Bun.env)) {
		if (!originalEnv.has(key)) {
			Reflect.deleteProperty(Bun.env, key);
		}
	}

	for (const [key, value] of originalEnv) {
		if (value === undefined) {
			Reflect.deleteProperty(Bun.env, key);
		} else {
			Reflect.set(Bun.env, key, value);
		}
	}

	if (process.cwd() !== originalCwd) {
		process.chdir(originalCwd);
	}

	process.exit = originalExit;
});
