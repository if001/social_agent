export type WebPageDocument = { readonly url: string; readonly title: string; readonly markdown: string };
export type WebArchiveContext = { readonly agentId: string; readonly runId: string; readonly eventId: string; readonly toolCallId: string };
export type WebArchiveSearchInput = { readonly query: string; readonly limit: number; readonly fetchedAfter?: string | undefined; readonly urlPrefix?: string | undefined };
export type WebArchiveSearchResult = { readonly snapshotId: string; readonly url: string; readonly title: string; readonly summary: string; readonly fetchedAt: string; readonly reference: { readonly type: "web-snapshot"; readonly id: string } };
export type ArchivedWebPage = WebArchiveSearchResult & { readonly status: string };

export interface WebPageSummarizer { summarize(input: { readonly url: string; readonly title: string; readonly markdown: string }, signal: AbortSignal): Promise<string>; }

export interface WebArchive {
  archivePages(documents: readonly WebPageDocument[], context: WebArchiveContext, signal: AbortSignal): Promise<readonly ArchivedWebPage[]>;
  search(input: WebArchiveSearchInput, signal: AbortSignal): Promise<readonly WebArchiveSearchResult[]>;
  read(snapshotId: string, offset?: number, maxCharacters?: number): Promise<{ snapshotId: string; offset: number; text: string; truncated: boolean }>;
  grep(snapshotId: string, pattern: string, contextLines?: number, maxMatches?: number, maxCharacters?: number): Promise<{ snapshotId: string; matches: readonly { line: number; text: string }[]; truncated: boolean }>;
}
