import { boundedEntries, lineRange, matchingRanges, textLines, textRange } from "../../src/infrastructure/tools/text-extraction.js";

describe("shared text extraction", () => {
  it("bounds long lines and reports continuation without pretending the line is complete", () => {
    expect(lineRange(["abcdefgh", "next"], 0, 2, 4)).toMatchObject({ content: "abcd", lineTruncated: true, truncated: true, nextStartLine: 2 });
    expect(textRange("abcdefgh", 4, 4)).toEqual({ text: "efgh", truncated: false });
  });
  it("handles empty input, CRLF and end of file", () => {
    expect(lineRange(textLines(""), 0, 5, 10)).toMatchObject({ content: "", truncated: false });
    expect(lineRange(textLines("a\r\nb"), 1, 5, 10)).toMatchObject({ content: "b", startLine: 2, endLine: 2, truncated: false });
    expect(textRange("abc", 9, 2)).toEqual({ text: "", truncated: false });
  });
  it("shares Unicode normalization and context boundaries", () => {
    expect([...matchingRanges(["ＡＢＣ", "middle", "abc"], "ABC", 1)]).toEqual([
      { line: 1, start: 0, lines: ["ＡＢＣ", "middle"] },
      { line: 3, start: 1, lines: ["middle", "abc"] }
    ]);
  });
  it("distinguishes an exact limit from omitted entries", () => {
    expect(boundedEntries(["ab", "cd"], 2, 4, (text) => text.length)).toEqual({ entries: ["ab", "cd"], truncated: false });
    expect(boundedEntries(["ab", "cd", "e"], 2, 4, (text) => text.length)).toEqual({ entries: ["ab", "cd"], truncated: true });
    expect(boundedEntries(["abc"], 2, 2, (text) => text.length)).toEqual({ entries: [], truncated: true });
  });
});
