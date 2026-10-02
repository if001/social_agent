import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import type { RegisteredTool } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";

const PathInput = z.object({ root: z.number().int().nonnegative(), path: z.string().min(1) });
const WriteInput = PathInput.extend({ content: z.string() });
const within = (root: string, target: string): boolean => { const path = relative(root, target); return path === "" || (!path.startsWith("..") && !isAbsolute(path)); };

async function checked(roots: readonly string[], index: number, path: string, mode: "existing" | "write"): Promise<string> {
  if (isAbsolute(path) || path.split(/[\\/]/u).includes("..")) throw new DomainError("VALIDATION", "File path escapes its allowed root");
  const root = await realpath(roots[index] ?? "").catch(() => undefined); if (root === undefined) throw new DomainError("VALIDATION", "Unknown or missing file root");
  const target = resolve(root, path);
  const verified = mode === "existing" ? await realpath(target).catch((error: unknown) => { throw new DomainError("NOT_FOUND", "File does not exist", { cause: error }); }) : resolve(await realpath(dirname(target)).catch((error: unknown) => { throw new DomainError("VALIDATION", "File parent does not exist", { cause: error }); }), target.split(/[\\/]/u).at(-1) ?? "");
  if (!within(root, verified)) throw new DomainError("VALIDATION", "File path resolves outside its allowed root");
  return verified;
}

export function createFileTools(roots: readonly string[]): readonly RegisteredTool[] {
  const read: RegisteredTool<z.infer<typeof PathInput>> = { name: "file_read", description: "Read an allowed file", schema: PathInput, execute: async (input) => ({ ok: true, value: await readFile(await checked(roots, input.root, input.path, "existing"), "utf8") }) };
  const write: RegisteredTool<z.infer<typeof WriteInput>> = { name: "file_write", description: "Write an allowed file", schema: WriteInput, execute: async (input) => { const path = await checked(roots, input.root, input.path, "write"); await mkdir(dirname(path), { recursive: true }); await writeFile(path, input.content); return { ok: true, value: { path: input.path } }; } };
  const remove: RegisteredTool<z.infer<typeof PathInput>> = { name: "file_delete", description: "Delete an allowed file", schema: PathInput, execute: async (input) => { await rm(await checked(roots, input.root, input.path, "existing")); return { ok: true, value: { path: input.path } }; } };
  return [read, write, remove];
}
