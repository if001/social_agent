import { Pool } from "pg";
import { z } from "zod";

import { CurrentRelationshipDescriptionSchema, CurrentSelfStorySchema } from "../src/domain/contracts.js";
import { createOllamaChatModel } from "../src/infrastructure/agent/ollama-provider.js";
import { modelJsonSchema } from "../src/infrastructure/agent/model-json-schema.js";

const OutputSchema = z.object({ selfStory: CurrentSelfStorySchema, relationshipDescription: CurrentRelationshipDescriptionSchema.optional() }).strict();
type Options = { readonly agentId: string; readonly apply: boolean };
const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.flatMap((item) => typeof item === "object" && item !== null && "text" in item && typeof item.text === "string" ? [item.text] : []).join("") : "";

function options(args: readonly string[]): Options {
  let agentId: string | undefined; let apply = false;
  for (let index = 0; index < args.length; index += 1) { const value = args[index]; if (value === "--") continue; if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; } if (value === "--apply") { apply = true; continue; } throw new Error("Usage: pnpm state:compact -- --agent-id <id> [--apply]"); }
  if (agentId === undefined || agentId.trim() === "") throw new Error("--agent-id is required");
  return { agentId, apply };
}

async function main(): Promise<void> {
  const input = options(process.argv.slice(2)); const connectionString = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  const baseUrl = process.env.OLLAMA_BASE_URL; const apiKey = process.env.OLLAMA_API_KEY; const modelName = process.env.OLLAMA_CHAT_MODEL;
  if (connectionString === "" || baseUrl === undefined || apiKey === undefined || modelName === undefined) throw new Error("POSTGRES_URL, OLLAMA_BASE_URL, OLLAMA_API_KEY and OLLAMA_CHAT_MODEL are required");
  const pool = new Pool({ connectionString, options: "-c search_path=app,public,ext" });
  try {
    const state = (await pool.query<{ self_story: string; relationships: unknown; disposition: string }>("select s.self_story,s.relationships,s.disposition from app.agent_states s where s.agent_id=$1", [input.agentId])).rows[0];
    if (state === undefined) throw new Error(`Agent state was not found: ${input.agentId}`);
    const memories = (await pool.query<{ content: string; importance: string }>("select content,importance from app.memories where agent_id=$1 order by occurred_at desc,id desc limit 8", [input.agentId])).rows;
    const model = createOllamaChatModel({ baseUrl, apiKey, model: modelName, think: "low" }).withConfig({ format: modelJsonSchema(OutputSchema) });
    const prompt = {
      currentSelfStory: state.self_story,
      currentRelationships: state.relationships,
      currentDisposition: state.disposition,
      recentMemories: memories
    };
    const system = "Current Selfと現在のユーザーRelationshipを一度だけ圧縮する。selfStoryは現在の自己理解・継続する役割・現在の変化だけを600文字以内で書く。relationshipDescriptionは現在の関係の型、安定した会話上の前提、未解決の約束だけを400文字以内で書く。出来事、日付、調査結果、完了済みTaskの履歴を列挙しない。根拠がなくRelationshipを残せない場合はrelationshipDescriptionを省略する。ID、Markdown、説明文を出さず構造化出力だけを返す。";
    const invoke = (content: unknown) => model.invoke([{ role: "system", content: system }, { role: "user", content: JSON.stringify(content) }], { signal: AbortSignal.timeout(120_000) });
    const raw = async (content: unknown): Promise<{ readonly value?: unknown; readonly error?: string }> => {
      const text = contentOf(await invoke(content)).trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
      try { return { value: JSON.parse(text) }; } catch (error) { return { error: error instanceof Error ? error.message : "Invalid JSON" }; }
    };
    const firstRaw = await raw(prompt);
    const first = firstRaw.value === undefined ? undefined : OutputSchema.safeParse(firstRaw.value);
    const output = first?.success ? first.data : OutputSchema.parse((await raw({ instruction: "直前の出力はschema検証に失敗した。内容を新たに判断せず、同じinputからselfStoryを必須の文字列として返す。currentSelfStoryやcurrentRelationshipsを出力へ複製せず、構造化出力だけを返す。", input: prompt, validationIssues: first === undefined ? [{ path: [], message: firstRaw.error ?? "Empty output" }] : first.error.issues.map(({ path, message }) => ({ path, message })) })).value);
    const report = { agentId: input.agentId, apply: input.apply, selfStoryLength: output.selfStory.length, relationshipLength: output.relationshipDescription?.length ?? 0, output };
    if (input.apply) {
      const relationships = output.relationshipDescription === undefined ? [] : [{ subjectId: "user-main", description: output.relationshipDescription }];
      await pool.query("update app.agent_states set self_story=$2, relationships=$3::jsonb, version=version+1, updated_at=now() where agent_id=$1", [input.agentId, output.selfStory, JSON.stringify(relationships)]);
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "State compaction failed"}\n`); process.exitCode = 1; });
