import { initSchema } from "@lib/db";
import { ingestFromExports } from "@features/ingest/service";

const EXPORTS_DIR = Bun.env.EXPORTS_DIR ?? "./exports";
initSchema();
const res = await ingestFromExports(EXPORTS_DIR);
console.log(`Ingested ${res.lists} lists from ${EXPORTS_DIR}`);
