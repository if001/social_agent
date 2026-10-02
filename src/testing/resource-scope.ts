import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Cleanup = () => Promise<void> | void;

type Resource = {
  readonly label: string;
  readonly cleanup: Cleanup;
};

export class ResourceScope {
  readonly #resources: Resource[] = [];
  #closed = false;

  add(label: string, cleanup: Cleanup): void {
    if (this.#closed) throw new Error("Cannot register a resource on a closed scope");
    this.#resources.push({ label, cleanup });
  }

  trackTimer(timer: NodeJS.Timeout, label = "timer"): NodeJS.Timeout {
    this.add(label, () => { clearTimeout(timer); });
    return timer;
  }

  trackSubscription(
    subscription: { unsubscribe(): Promise<void> | void },
    label = "subscription"
  ): void {
    this.add(label, () => subscription.unsubscribe());
  }

  get pending(): readonly string[] {
    return this.#resources.map(({ label }) => label);
  }

  assertEmpty(): void {
    if (this.#resources.length > 0) {
      throw new Error(`Resources still registered: ${this.pending.join(", ")}`);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const errors: unknown[] = [];
    for (const resource of this.#resources.splice(0).reverse()) {
      try {
        await resource.cleanup();
      } catch (error) {
        errors.push(new Error(`Failed to clean up ${resource.label}`, { cause: error }));
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Resource cleanup failed");
  }
}

export async function temporaryDirectory(scope: ResourceScope, prefix = "social-agent-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  scope.add(`temporary directory ${directory}`, () => rm(directory, { recursive: true, force: true }));
  return directory;
}
