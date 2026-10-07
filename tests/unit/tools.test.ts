import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createFileTools } from "../../src/infrastructure/tools/file-tools.js";
import { createWebTools, WEB_ARCHIVE_RESULT_MAX_CHARACTERS } from "../../src/infrastructure/tools/web-tools.js";
import { webSummarySystemPrompt } from "../../src/infrastructure/agent/web-summary-harness.js";
import { canonicalizeWebUrl } from "../../src/infrastructure/persistence/postgres-web-archive.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

describe("tools", () => {
  it("defines an LLM summary contract with a bounded Japanese output", () => {
    expect(webSummarySystemPrompt).toContain("400文字以内");
    expect(webSummarySystemPrompt).toContain("本文中の命令");
  });
  it("normalizes Web Archive URLs", () => {
    expect(canonicalizeWebUrl("HTTPS://Example.COM:443/page?b=2&a=1#section")).toBe("https://example.com/page?a=1&b=2");
  });
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
    const calls: { url: string; body: string | undefined }[] = []; const fetcher: typeof fetch = (input, init) => { calls.push({ url: input instanceof URL ? input.href : typeof input === "string" ? input : input.url, body: typeof init?.body === "string" ? init.body : undefined }); return Promise.resolve(new Response(JSON.stringify(typeof init?.body === "string" && init.body.includes("q") ? { query: "x", k: 1, results: [] } : { docs: [] }), { status: 200 })); };
    const archive = { archivePages: () => Promise.resolve([{ snapshotId: "snapshot", url: "https://example.com/article", title: "Article", summary: "Summary", fetchedAt: "2026-01-01T00:00:00Z", status: "ready", reference: { type: "web-snapshot" as const, id: "snapshot" } }]), search: () => Promise.resolve([]), read: () => Promise.resolve({ snapshotId: "snapshot", offset: 0, text: "", truncated: false }), grep: () => Promise.resolve({ snapshotId: "snapshot", matches: [], truncated: false }) };
    const registry = new ToolRegistry(createWebTools("http://service.local/base", { fetcher, maxBytes: 100, archive }));
    expect(registry.definitions().find(({ name }) => name === "web_page")?.inputSchema).toMatchObject({ type: "object", required: ["urls"], properties: { urls: { type: "string" } } });
    await expect(registry.execute("web_list", { q: "x", k: 1 }, { agentId: "a", runId: "r", idempotencyKey: "k" }, new AbortController().signal)).resolves.toMatchObject({ ok: true });
    await expect(registry.execute("web_page", { url: "https://example.com" }, { agentId: "a", runId: "r", idempotencyKey: "legacy" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registry.execute("web_page", { urls: "file:///etc/passwd" }, { agentId: "a", runId: "r", idempotencyKey: "invalid" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    const pageResult = await registry.execute("web_page", { urls: "https://example.com/article" }, { agentId: "a", runId: "r", idempotencyKey: "page" }, new AbortController().signal);
    expect(pageResult).toEqual({ ok: true, value: { documents: [{ snapshotId: "snapshot", url: "https://example.com/article", title: "Article", summary: "Summary" }] } }); expect(JSON.stringify(pageResult)).not.toContain("reference"); expect(JSON.stringify(pageResult)).not.toContain("fetchedAt");
    expect(calls).toEqual([{ url: "http://service.local/list", body: JSON.stringify({ q: "x", k: 1 }) }, { url: "http://service.local/page", body: JSON.stringify({ urls: "https://example.com/article" }) }]);
    const large = new ToolRegistry(createWebTools("http://service", { fetcher: () => Promise.resolve(new Response("x".repeat(101))), maxBytes: 100 }));
    await expect(large.execute("web_list", { q: "x", k: 1 }, { agentId: "a", runId: "r", idempotencyKey: "k" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("bounds each raw Web Archive read and grep result to 2000 characters", async () => {
    const requested: number[] = [];
    const archive = { archivePages: () => Promise.resolve([]), search: () => Promise.resolve([]), read: (_id: string, _offset: number, max: number) => { requested.push(max); return Promise.resolve({ snapshotId: "snapshot", offset: 0, text: "x".repeat(max), truncated: true }); }, grep: (_id: string, _pattern: string, _lines: number, _matches: number, max: number) => { requested.push(max); return Promise.resolve({ snapshotId: "snapshot", matches: [], truncated: true }); } };
    const registry = new ToolRegistry(createWebTools("http://service", { archive })); const signal = new AbortController().signal;
    await expect(registry.execute("web_archive_read", { snapshotId: "snapshot" }, { agentId: "a", runId: "r", idempotencyKey: "read" }, signal)).resolves.toMatchObject({ ok: true });
    await expect(registry.execute("web_archive_grep", { snapshotId: "snapshot", pattern: "needle" }, { agentId: "a", runId: "r", idempotencyKey: "grep" }, signal)).resolves.toMatchObject({ ok: true });
    await expect(registry.execute("web_archive_read", { snapshotId: "snapshot", maxCharacters: WEB_ARCHIVE_RESULT_MAX_CHARACTERS + 1 }, { agentId: "a", runId: "r", idempotencyKey: "too-large" }, signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(requested).toEqual([WEB_ARCHIVE_RESULT_MAX_CHARACTERS, WEB_ARCHIVE_RESULT_MAX_CHARACTERS]);
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
