// src/lib/bootstrap.ts
import type { Database } from "bun:sqlite";
import { initSchema, withDB } from "@lib/db";
import { createLogger } from "@lib/logger";

/** Call once at process startup (e.g. in CLI main). */
export function initBootstrap(database?: Database): void {
	// Initialise schema on the provided DB (or the default via withDB)
	initSchema(withDB(database));
}

// Shared logger for CLIs (pure; no side effects)
export const log = createLogger();
