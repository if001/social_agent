import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import { BotPersonaSchema, type BotPersona } from "../domain/contracts.js";

export async function loadPersonaFile(path: string): Promise<BotPersona> {
  const content = await readFile(path, "utf8");
  return BotPersonaSchema.parse(parse(content));
}
