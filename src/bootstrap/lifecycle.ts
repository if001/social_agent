export type LifecycleState = "starting" | "ready" | "degraded" | "stopping" | "stopped";

const allowed: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  starting: ["ready", "degraded", "stopping"], ready: ["degraded", "stopping"],
  degraded: ["ready", "stopping"], stopping: ["stopped"], stopped: []
};

export class ProcessLifecycle {
  readonly #controller = new AbortController();
  #state: LifecycleState = "starting";
  get state(): LifecycleState { return this.#state; }
  get signal(): AbortSignal { return this.#controller.signal; }
  get accepting(): boolean { return this.#state === "ready" || this.#state === "degraded"; }
  transition(next: LifecycleState): void {
    if (!allowed[this.#state].includes(next)) throw new Error(`Invalid lifecycle transition: ${this.#state} -> ${next}`);
    this.#state = next;
    if (next === "stopping") this.#controller.abort(new Error("Process is stopping"));
  }
  assertAccepting(): void { if (!this.accepting) throw new Error(`Process is not accepting work while ${this.#state}`); }
}
