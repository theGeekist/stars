// src/lib/bootstrap.ts
import { initSchema } from "@lib/db";
import { createLogger } from "@lib/logger";

// Initialize DB schema once for all CLI commands.
initSchema();

// Shared logger for CLIs
export const log = createLogger();
