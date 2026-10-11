import { setTimeout } from "node:timers/promises";

/** Waiting ends normally on cancellation; the caller decides whether to continue. */
export async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try { await setTimeout(milliseconds, undefined, { signal }); }
  catch (error) { if (!(error instanceof Error && error.name === "AbortError")) throw error; }
}
