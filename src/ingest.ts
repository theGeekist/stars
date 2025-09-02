import { ingestFromExports } from "@features/ingest/service";
import { initSchema } from "@lib/db";
import { createLogger } from "@lib/logger";

const EXPORTS_DIR = Bun.env.EXPORTS_DIR ?? "./exports";
initSchema();
const res = await ingestFromExports(EXPORTS_DIR);
createLogger().success(`Ingested ${res.lists} lists from ${EXPORTS_DIR}`);
