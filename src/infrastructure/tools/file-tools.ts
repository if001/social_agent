import { boundedEntries, lineRange, matchingRanges, normalizeSearchText, textLines } from "./text-extraction.js";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import type { RegisteredTool } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";

const MAX_READ_CHARACTERS = 4_000;
const MAX_READ_LINES = 100;
const MAX_LIST_ENTRIES = 200;
const MAX_FIND_RESULTS = 200;
const MAX_FIND_DEPTH = 10;
const MAX_GREP_MATCHES = 50;
const MAX_GREP_CHARACTERS = 4_000;
const MAX_GREP_FILES = 500;
const MAX_GREP_FILE_BYTES = 2_000_000;

const PathInput = z.object({ root: z.number().int().nonnegative().describe("Tool説明に列挙された許可rootの番号"), path: z.string().min(1).describe("選択したrootからの相対パス") });
const WriteInput = PathInput.extend({ content: z.string().describe("ファイルへ書き込む完全な本文") });
const ReadInput = PathInput.extend({ mode: z.enum(["head", "tail", "range"]).default("head").describe("先頭、末尾、または指定行から読む方法"), startLine: z.number().int().positive().optional().describe("range時の1始まり開始行"), maxLines: z.number().int().positive().max(MAX_READ_LINES).default(50).describe("返す最大行数"), maxCharacters: z.number().int().positive().max(MAX_READ_CHARACTERS).default(2_000).describe("返す最大文字数") }).superRefine((value, context) => {
  if (value.mode === "range" && value.startLine === undefined) context.addIssue({ code: "custom", path: ["startLine"], message: "range mode requires startLine" });
});
const ListInput = z.object({ root: PathInput.shape.root, path: PathInput.shape.path.default("."), maxEntries: z.number().int().positive().max(MAX_LIST_ENTRIES).default(100).describe("返す最大エントリ数") });
const FindInput = z.object({ root: PathInput.shape.root, path: PathInput.shape.path.default("."), query: z.string().min(1).describe("ファイル名またはディレクトリ名に含まれるリテラル文字列"), maxDepth: z.number().int().nonnegative().max(MAX_FIND_DEPTH).default(5).describe("探索する最大階層"), maxResults: z.number().int().positive().max(MAX_FIND_RESULTS).default(100).describe("返す最大件数") });
const GrepInput = z.object({ root: PathInput.shape.root, path: PathInput.shape.path.default("."), pattern: z.string().min(1).describe("本文から検索するリテラル文字列"), contextLines: z.number().int().nonnegative().max(5).default(2).describe("一致行の前後に含める行数"), maxMatches: z.number().int().positive().max(MAX_GREP_MATCHES).default(20).describe("返す最大一致件数"), maxCharacters: z.number().int().positive().max(MAX_GREP_CHARACTERS).default(2_000).describe("返す最大文字数") });

const within = (root: string, target: string): boolean => { const path = relative(root, target); return path === "" || (!path.startsWith("..") && !isAbsolute(path)); };

async function checked(roots: readonly string[], index: number, path: string, mode: "existing" | "write"): Promise<{ readonly root: string; readonly target: string }> {
  if (isAbsolute(path) || path.split(/[\\/]/u).includes("..")) throw new DomainError("VALIDATION", "File path escapes its allowed root");
  const root = await realpath(roots[index] ?? "").catch(() => undefined); if (root === undefined) throw new DomainError("VALIDATION", "Unknown or missing file root");
  const target = resolve(root, path);
  const verified = mode === "existing" ? await realpath(target).catch((error: unknown) => { throw new DomainError("NOT_FOUND", "File does not exist", { cause: error }); }) : resolve(await realpath(dirname(target)).catch((error: unknown) => { throw new DomainError("VALIDATION", "File parent does not exist", { cause: error }); }), target.split(/[\\/]/u).at(-1) ?? "");
  if (!within(root, verified)) throw new DomainError("VALIDATION", "File path resolves outside its allowed root");
  return { root, target: verified };
}

const rootMap = (roots: readonly string[]): string => roots.map((root, index) => `${String(index)}=${root}`).join(", ") || "none";
const relativePath = (root: string, target: string): string => relative(root, target) || ".";

async function walk(root: string, start: string, maxDepth: number, visit: (path: string, type: "file" | "directory") => boolean | Promise<boolean>): Promise<void> {
  const queue: { path: string; depth: number }[] = [{ path: start, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift(); if (current === undefined) break;
    const entries = (await readdir(current.path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(current.path, entry.name); if (!within(root, path)) continue;
      const type = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : undefined; if (type === undefined) continue;
      if (!await visit(path, type)) return;
      if (type === "directory" && current.depth < maxDepth) queue.push({ path, depth: current.depth + 1 });
    }
  }
}

export function createFileTools(options: { readonly readRoots: readonly string[]; readonly writeRoots: readonly string[] }): readonly RegisteredTool[] {
  const readRoots = options.readRoots; const writeRoots = options.writeRoots;
  const read: RegisteredTool<z.infer<typeof ReadInput>> = { name: "file_read", description: `Read a bounded line range from an allowed text file. Read roots: ${rootMap(readRoots)}`, schema: ReadInput, resultPolicy: { kind: "content-read", defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 }, execute: async (input) => {
    const { root, target } = await checked(readRoots, input.root, input.path, "existing"); const info = await stat(target); if (!info.isFile()) throw new DomainError("VALIDATION", "File path is not a regular file");
    const lines = textLines(await readFile(target, "utf8"));
    const start = input.mode === "tail" ? Math.max(0, lines.length - input.maxLines) : input.mode === "range" ? (input.startLine ?? 1) - 1 : 0;
    return { ok: true, value: { path: relativePath(root, target), mode: input.mode, ...lineRange(lines, start, input.maxLines, input.maxCharacters) } };
  } };
  const list: RegisteredTool<z.infer<typeof ListInput>> = { name: "file_list", description: `List entries directly inside an allowed directory. Read roots: ${rootMap(readRoots)}`, schema: ListInput, resultPolicy: { kind: "standard" }, execute: async (input) => {
    const { root, target } = await checked(readRoots, input.root, input.path, "existing"); const info = await stat(target); if (!info.isDirectory()) throw new DomainError("VALIDATION", "File path is not a directory");
    const all = (await readdir(target, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name)); const entries = all.slice(0, input.maxEntries).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other" }));
    return { ok: true, value: { path: relativePath(root, target), entries, truncated: all.length > entries.length } };
  } };
  const find: RegisteredTool<z.infer<typeof FindInput>> = { name: "file_find", description: `Find file and directory names below an allowed directory using literal case-insensitive matching. Read roots: ${rootMap(readRoots)}`, schema: FindInput, resultPolicy: { kind: "standard" }, execute: async (input) => {
    const { root, target } = await checked(readRoots, input.root, input.path, "existing"); if (!(await stat(target)).isDirectory()) throw new DomainError("VALIDATION", "File path is not a directory"); const matches: { path: string; type: "file" | "directory" }[] = []; let truncated = false; const query = normalizeSearchText(input.query);
    await walk(root, target, input.maxDepth, (path, type) => { if (path.split(/[\\/]/u).at(-1)?.normalize("NFKC").toLocaleLowerCase("ja").includes(query) === true) matches.push({ path: relativePath(root, path), type }); if (matches.length >= input.maxResults) { truncated = true; return false; } return true; });
    return { ok: true, value: { path: relativePath(root, target), query: input.query, matches, truncated } };
  } };
  const grep: RegisteredTool<z.infer<typeof GrepInput>> = { name: "file_grep", description: `Search bounded text snippets below an allowed path using literal case-insensitive matching. Read roots: ${rootMap(readRoots)}`, schema: GrepInput, resultPolicy: { kind: "content-read", defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 }, execute: async (input) => {
    const { root, target } = await checked(readRoots, input.root, input.path, "existing"); const targetInfo = await stat(target); const files: string[] = []; if (targetInfo.isFile()) files.push(target); else if (targetInfo.isDirectory()) await walk(root, target, MAX_FIND_DEPTH, (path, type) => { if (type === "file") files.push(path); return files.length < MAX_GREP_FILES; }); else throw new DomainError("VALIDATION", "File path is not a regular file or directory");
    const matches: { path: string; line: number; snippet: string }[] = [];
    let outputCharacters = 0;
    let outputTruncated = false;
    for (const file of files) {
      if ((await stat(file)).size > MAX_GREP_FILE_BYTES) continue;
      let content: string;
      try { content = await readFile(file, "utf8"); } catch { continue; }
      if (content.includes("\u0000")) continue;
      const path = relativePath(root, file);
      const selection = boundedEntries(matchingRanges(textLines(content), input.pattern, input.contextLines), input.maxMatches - matches.length, input.maxCharacters - outputCharacters, (match) => path.length + match.lines.join("\n").length);
      for (const match of selection.entries) {
        const snippet = match.lines.join("\n");
        matches.push({ path, line: match.line, snippet });
        outputCharacters += path.length + snippet.length;
      }
      if (selection.truncated) { outputTruncated = true; break; }
    }
    return { ok: true, value: { path: relativePath(root, target), pattern: input.pattern, matches, truncated: files.length >= MAX_GREP_FILES || outputTruncated } };
  } };
  const write: RegisteredTool<z.infer<typeof WriteInput>> = { name: "file_write", description: `Write an allowed file. Write roots: ${rootMap(writeRoots)}`, schema: WriteInput, resultPolicy: { kind: "standard" }, execute: async (input) => { const { target } = await checked(writeRoots, input.root, input.path, "write"); await mkdir(dirname(target), { recursive: true }); await writeFile(target, input.content); return { ok: true, value: { path: input.path } }; } };
  const remove: RegisteredTool<z.infer<typeof PathInput>> = { name: "file_delete", description: `Delete an allowed file. Write roots: ${rootMap(writeRoots)}`, schema: PathInput, resultPolicy: { kind: "standard" }, execute: async (input) => { await rm((await checked(writeRoots, input.root, input.path, "existing")).target); return { ok: true, value: { path: input.path } }; } };
  return [read, list, find, grep, write, remove];
}
