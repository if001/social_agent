import { getEventListeners } from "node:events";
import { abortableDelay } from "../../src/shared/abortable-delay.js";

describe("abortable delay", () => {
  it("removes listeners on repeated normal completion", async () => {
    const signal = new AbortController().signal;
    for (let index = 0; index < 15; index += 1) await abortableDelay(1, signal);
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });
  it("finishes before and during cancellation without retaining listeners", async () => {
    const controller = new AbortController();
    const pending = abortableDelay(60_000, controller.signal);
    controller.abort();
    await pending;
    await abortableDelay(60_000, controller.signal);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
