import { ingestFromExports } from "@features/ingest/service";
import { initSchema } from "@lib/db";

const EXPORTS_DIR = Bun.env.EXPORTS_DIR ?? "./exports";
initSchema();
const res = await ingestFromExports(EXPORTS_DIR);
console.log(`Ingested ${res.lists} lists from ${EXPORTS_DIR}`);
