import { runPageIngestHost } from "./bootstrap/page-ingest-host.js";
import { loadPageIngestStartConfig } from "./bootstrap/page-ingest-start.js";

const config = await loadPageIngestStartConfig(process.argv.slice(2));
const controller = new AbortController();
const stop = (): void => { controller.abort(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await runPageIngestHost(config, controller.signal);
