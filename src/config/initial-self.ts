import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import { InitialSelfConfigSchema, type InitialSelfConfig } from "../domain/contracts.js";

export async function loadInitialSelfFile(path: string): Promise<InitialSelfConfig> {
  return InitialSelfConfigSchema.parse(parse(await readFile(path, "utf8")));
}
