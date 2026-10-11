/** Pure text operations shared by file and archived-page readers. */
export const normalizeSearchText = (text: string): string => text.normalize("NFKC").toLocaleLowerCase("ja");
export const textLines = (text: string): string[] => text.split(/\r?\n/u);

export function textRange(text: string, offset: number, maxCharacters: number): { text: string; truncated: boolean } {
  const value = text.slice(offset, offset + maxCharacters);
  return { text: value, truncated: offset + value.length < text.length };
}

export function lineRange(lines: readonly string[], start: number, maxLines: number, maxCharacters: number): { content: string; startLine: number; endLine: number; totalLines: number; truncated: boolean; lineTruncated: boolean; nextStartLine?: number } {
  const selected: string[] = [];
  let characters = 0;
  for (const line of lines.slice(start, start + maxLines)) {
    const addition = line.length + (selected.length === 0 ? 0 : 1);
    if (characters + addition > maxCharacters) break;
    selected.push(line);
    characters += addition;
  }
  let lineTruncated = false;
  if (selected.length === 0 && start < lines.length) {
    const first = textRange(lines[start] ?? "", 0, maxCharacters);
    selected.push(first.text);
    lineTruncated = first.truncated;
  }
  const startLine = Math.min(start + 1, lines.length);
  const nextStartLine = start + selected.length < lines.length ? start + selected.length + 1 : undefined;
  return { content: selected.join("\n"), startLine, endLine: selected.length === 0 ? startLine : startLine + selected.length - 1, totalLines: lines.length, truncated: lineTruncated || nextStartLine !== undefined, lineTruncated, ...(nextStartLine === undefined ? {} : { nextStartLine }) };
}

export function* matchingRanges(lines: readonly string[], pattern: string, contextLines: number): Generator<{ line: number; start: number; lines: readonly string[] }> {
  const needle = normalizeSearchText(pattern);
  for (let index = 0; index < lines.length; index += 1) {
    if (!normalizeSearchText(lines[index] ?? "").includes(needle)) continue;
    const start = Math.max(0, index - contextLines);
    yield { line: index + 1, start, lines: lines.slice(start, Math.min(lines.length, index + contextLines + 1)) };
  }
}

export function boundedEntries<T>(entries: Iterable<T>, maxEntries: number, maxCharacters: number, cost: (entry: T) => number): { entries: T[]; truncated: boolean } {
  const selected: T[] = [];
  let used = 0;
  for (const entry of entries) {
    const size = cost(entry);
    if (selected.length >= maxEntries || used + size > maxCharacters) return { entries: selected, truncated: true };
    selected.push(entry);
    used += size;
  }
  return { entries: selected, truncated: false };
}
