import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const ExplorationDomainCatalogSchema = z.object({
  version: z.literal(1),
  topics: z.array(z.string().trim().min(3).max(120)).min(100).max(200)
}).strict().superRefine((value, context) => {
  if (new Set(value.topics).size !== value.topics.length) context.addIssue({ code: "custom", path: ["topics"], message: "topics must be unique" });
});

export type ExplorationDomainCatalog = z.infer<typeof ExplorationDomainCatalogSchema>;

export async function loadExplorationDomainCatalog(path: string): Promise<ExplorationDomainCatalog> {
  return ExplorationDomainCatalogSchema.parse(parse(await readFile(path, "utf8")));
}
