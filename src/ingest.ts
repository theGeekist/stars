import { ingestFromExports } from "@features/ingest/service";
import { log } from "@lib/bootstrap";

const EXPORTS_DIR = Bun.env.EXPORTS_DIR ?? "./exports";
const res = await ingestFromExports(EXPORTS_DIR);
log.success(`Ingested ${res.lists} lists from ${EXPORTS_DIR}`);
