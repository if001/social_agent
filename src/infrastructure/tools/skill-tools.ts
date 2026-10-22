import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import type { RegisteredTool } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";

const SkillReadInput = z.object({ name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/u, "skill name must use lowercase letters, digits, and hyphens") }).strict();

export function createSkillTools(options: { readonly skillsRoot: string }): readonly RegisteredTool[] {
  const root = resolve(options.skillsRoot);
  const read: RegisteredTool<z.infer<typeof SkillReadInput>> = {
    name: "skill_read",
    description: "Read a runtime SKILL.md by skill name before handling the current Event. Use only names listed in the Event skill routing.",
    schema: SkillReadInput,
    resultPolicy: { kind: "content-read", defaultRequestCharacters: 1_200, runCharacterBudget: 4_000 },
    execute: async ({ name }) => {
      if (!/^[a-z0-9-]+$/u.test(name)) throw new DomainError("VALIDATION", `Invalid skill name: ${name}`);
      const content = await readFile(join(root, name, "SKILL.md"), "utf8").catch((error: unknown) => {
        throw new DomainError("NOT_FOUND", `Unknown skill: ${name}`, { cause: error });
      });
      return { ok: true, value: { name, content } };
    }
  };
  return [read];
}
