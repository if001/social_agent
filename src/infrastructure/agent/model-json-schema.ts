import { z } from "zod";

export type ModelJsonSchema = Record<string, unknown> & { readonly type: "object" };

function withoutProviderNoise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutProviderNoise);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key !== "$schema" && !(key === "pattern" && typeof item === "string")).map(([key, item]) => [key, withoutProviderNoise(item)]));
}

export function modelJsonSchema(schema: z.ZodType): ModelJsonSchema {
  return withoutProviderNoise(z.toJSONSchema(schema)) as ModelJsonSchema;
}
