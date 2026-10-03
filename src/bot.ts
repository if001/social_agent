import { createProductionBotHost } from "./bootstrap/bot-host.js";
import { loadBotStartConfig } from "./bootstrap/bot-start.js";

const config = await loadBotStartConfig(process.argv.slice(2));
const host = createProductionBotHost(config);
let stopping: Promise<void> | undefined;
const stop = (): void => { stopping ??= host.stop(); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try { await host.start(); await host.wait(); }
finally { await (stopping ?? host.stop()); }
