import { access } from "node:fs/promises";

import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

describe("project foundation", () => {
  it("cleans resources in reverse registration order", async () => {
    const order: string[] = [];
    const scope = new ResourceScope();
    scope.add("first", () => { order.push("first"); });
    scope.add("second", () => { order.push("second"); });

    await scope.close();

    expect(order).toEqual(["second", "first"]);
    scope.assertEmpty();
  });

  it("reports resources that a test has not cleaned", () => {
    const scope = new ResourceScope();
    scope.add("open file handle", () => { /* detected before cleanup */ });

    expect(() => { scope.assertEmpty(); }).toThrow("open file handle");
  });

  it("removes temporary directories with the scope", async () => {
    const scope = new ResourceScope();
    const directory = await temporaryDirectory(scope);
    await access(directory);

    await scope.close();

    await expect(access(directory)).rejects.toThrow();
  });

  it("clears tracked timers", async () => {
    const scope = new ResourceScope();
    let fired = false;
    scope.trackTimer(setTimeout(() => { fired = true; }, 5));

    await scope.close();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fired).toBe(false);
  });
});
