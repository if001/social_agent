import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createFileTools } from "../../src/infrastructure/tools/file-tools.js";
import { createWebTools } from "../../src/infrastructure/tools/web-tools.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

describe("tools", () => {
  it("exposes each registered input schema to the Agent", () => {
    const registry = new ToolRegistry([{ name: "known", description: "Known", schema: z.object({ value: z.string() }), execute: () => Promise.resolve({ ok: true }) }]);
    expect(registry.definitions()[0]?.inputSchema).toMatchObject({ type: "object", required: ["value"] });
  });

  it("rejects unknown tools and invalid input before side effects", async () => {
    let calls = 0; const registry = new ToolRegistry([{ name: "known", description: "Known", schema: z.object({ value: z.string() }), execute: () => { calls += 1; return Promise.resolve({ ok: true }); } }]);
    await expect(registry.execute("missing", {}, { agentId: "a", runId: "r", idempotencyKey: "k" }, new AbortController().signal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(registry.execute("known", {}, { agentId: "a", runId: "r", idempotencyKey: "k" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" }); expect(calls).toBe(0);
  });

  it("returns the same execution for a repeated idempotency key and rejects conflicting input", async () => {
    let calls = 0;
    const registry = new ToolRegistry([{ name: "write", description: "Write", schema: z.object({ value: z.string() }), execute: () => { calls += 1; return Promise.resolve({ ok: true, value: calls }); } }]);
    const context = { agentId: "a", runId: "r", idempotencyKey: "r:tool-1" };
    await expect(registry.execute("write", { value: "same" }, context, new AbortController().signal)).resolves.toEqual({ ok: true, value: 1 });
    await expect(registry.execute("write", { value: "same" }, context, new AbortController().signal)).resolves.toEqual({ ok: true, value: 1 });
    await expect(registry.execute("write", { value: "different" }, context, new AbortController().signal)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(calls).toBe(1);
  });

  it("validates web request, response, URL, size and fixed service origin", async () => {
    const calls: string[] = []; const fetcher: typeof fetch = (input, init) => { calls.push(input instanceof URL ? input.href : typeof input === "string" ? input : input.url); return Promise.resolve(new Response(JSON.stringify(typeof init?.body === "string" && init.body.includes("q") ? { query: "x", k: 1, results: [] } : { docs: [] }), { status: 200 })); };
    const registry = new ToolRegistry(createWebTools("http://service.local/base", { fetcher, maxBytes: 100 }));
    await expect(registry.execute("web_list", { q: "x", k: 1 }, { agentId: "a", runId: "r", idempotencyKey: "k" }, new AbortController().signal)).resolves.toMatchObject({ ok: true });
    await expect(registry.execute("web_page", { url: "file:///etc/passwd" }, { agentId: "a", runId: "r", idempotencyKey: "k" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls).toEqual(["http://service.local/list"]);
    const large = new ToolRegistry(createWebTools("http://service", { fetcher: () => Promise.resolve(new Response("x".repeat(101))), maxBytes: 100 }));
    await expect(large.execute("web_list", { q: "x", k: 1 }, { agentId: "a", runId: "r", idempotencyKey: "k" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("normalizes web timeout, HTTP, JSON and schema failures", async () => {
    const context = { agentId: "a", runId: "r", idempotencyKey: "k" }; const signal = new AbortController().signal;
    const execute = (fetcher: typeof fetch, timeoutMs = 100) => new ToolRegistry(createWebTools("http://service", { fetcher, timeoutMs })).execute("web_list", { q: "x", k: 1 }, context, signal);
    await expect(execute(() => Promise.resolve(new Response("down", { status: 500 })))).rejects.toMatchObject({ code: "EXTERNAL" });
    await expect(execute(() => Promise.resolve(new Response("{")))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(execute(() => Promise.resolve(new Response("{}")))).rejects.toMatchObject({ code: "VALIDATION" });
    const pending: typeof fetch = (_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => { reject(new Error("timeout")); }, { once: true }); });
    await expect(execute(pending, 1)).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("keeps read, write and delete inside real roots including symlinks", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const outside = await temporaryDirectory(scope); await mkdir(join(root, "sub")); await writeFile(join(outside, "secret"), "secret"); await symlink(outside, join(root, "escape"));
    const registry = new ToolRegistry(createFileTools([root])); const context = (idempotencyKey: string) => ({ agentId: "a", runId: "r", idempotencyKey }); const signal = new AbortController().signal;
    await registry.execute("file_write", { root: 0, path: "sub/note", content: "hello" }, context("write"), signal); expect(await readFile(join(root, "sub/note"), "utf8")).toBe("hello");
    await expect(registry.execute("file_read", { root: 0, path: "../outside" }, context("read-parent"), signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registry.execute("file_read", { root: 0, path: join(outside, "secret") }, context("read-absolute"), signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registry.execute("file_read", { root: 0, path: "escape/secret" }, context("read-symlink"), signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await scope.close();
  });
});
