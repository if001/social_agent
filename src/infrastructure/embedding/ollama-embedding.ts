import { DomainError } from "../../domain/contracts.js";
import type { EmbeddingProvider } from "../../application/ports.js";

export type EmbeddingMetadata = { readonly baseUrl: string; readonly model: string; readonly dimension: number };

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  constructor(readonly metadata: EmbeddingMetadata, private readonly fetcher: typeof fetch = fetch) { this.dimension = metadata.dimension; }
  async embed(texts: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]> {
    let response: Response;
    try { response = await this.fetcher(new URL("/api/embed", this.metadata.baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.metadata.model, input: texts }), signal }); }
    catch (error) { throw new DomainError(signal.aborted ? "ABORTED" : "EXTERNAL", "Embedding provider failed", { cause: error }); }
    if (!response.ok) throw new DomainError("EXTERNAL", `Embedding provider returned HTTP ${String(response.status)}`);
    const body: unknown = await response.json().catch((error: unknown) => { throw new DomainError("EXTERNAL", "Embedding response was invalid", { cause: error }); });
    if (typeof body !== "object" || body === null || !("embeddings" in body) || !Array.isArray(body.embeddings)) throw new DomainError("VALIDATION", "Embedding response has no embeddings");
    const embeddings: unknown[] = body.embeddings as unknown[];
    if (embeddings.length !== texts.length || embeddings.some((vector) => !Array.isArray(vector) || vector.length !== this.dimension || vector.some((value) => typeof value !== "number" || !Number.isFinite(value)))) throw new DomainError("VALIDATION", "Embedding dimension or count mismatch");
    return embeddings as number[][];
  }
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  constructor(private readonly vectors: Readonly<Record<string, readonly number[]>>, dimension?: number) { this.dimension = dimension ?? Object.values(vectors)[0]?.length ?? 0; }
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    if (signal?.aborted === true) return Promise.reject(new DomainError("ABORTED", "Embedding request was aborted", { cause: signal.reason }));
    return Promise.resolve(texts.map((text) => {
      const vector = this.vectors[text];
      if (vector === undefined) throw new DomainError("NOT_FOUND", `No fake embedding for: ${text}`);
      if (vector.length !== this.dimension) throw new DomainError("VALIDATION", "Fake embedding dimension mismatch");
      return vector;
    }));
  }
}
