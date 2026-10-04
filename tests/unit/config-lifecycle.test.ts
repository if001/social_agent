import { mkdir, writeFile } from "node:fs/promises";

import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { assertDistinctBotConfigs, loadConfig } from "../../src/config/config.js";
import { loadBotStartConfig, parseBotStartArguments } from "../../src/bootstrap/bot-start.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { redactSecrets } from "../../src/observability/redaction.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

const required = `BOT_ID=sample\nPOSTGRES_URL=postgres://sample\nADMIN_POSTGRES_URL=postgres://admin\nSIMPLE_CLIENT_BASE_URL=http://web\nOLLAMA_BASE_URL=https://chat\nOLLAMA_API_KEY=sample-key\nOLLAMA_CHAT_MODEL=chat\nOLLAMA_EMBEDDING_BASE_URL=http://embedding\nOLLAMA_EMBEDDING_MODEL=embed\nOLLAMA_EMBEDDING_DIMENSION=768\n`;

describe("configuration and lifecycle", () => {
  it("loads sample, then .env, then process overrides", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope);
    await writeFile(`${cwd}/.env.sample`, required); await writeFile(`${cwd}/.env`, "BOT_ID=local\nOLLAMA_CHAT_MODEL=local-model\n");
    const config = await loadConfig({ cwd, environment: { BOT_ID: "process" } });
    expect(config.botId).toBe("process"); expect(config.chat.model).toBe("local-model"); expect(config.embedding.dimension).toBe(768);
    await scope.close();
  });

  it("loads process-specific bot files after .env and keeps bot destinations distinct", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope);
    await writeFile(`${cwd}/.env.sample`, required);
    await writeFile(`${cwd}/.env`, "BOT_ID=local\n");
    const discord = "DISCORD_BOT_TOKEN=secret\nDISCORD_BOT_USER_ID=user\nDISCORD_OWNER_IDS=owner,owner\nDISCORD_CHANNEL_IDS=channel\n";
    await writeFile(`${cwd}/.env.bot-a`, `BOT_ID=bot-a\n${discord}`);
    await writeFile(`${cwd}/.env.bot-b`, `BOT_ID=bot-b\n${discord}`);
    const first = await loadBotStartConfig(["--env-file", ".env.bot-a"], { cwd, environment: {} });
    const second = await loadBotStartConfig(["--env-file", ".env.bot-b"], { cwd, environment: {} });
    if (first.discord === undefined) throw new Error("missing first Discord config");
    const firstDiscord = first.discord;
    expect(first).toMatchObject({ botId: "bot-a", familyId: "default", defaultOutputDestination: "discord:bot-a", discord: { ownerIds: ["owner"], channelIds: ["channel"], queueDestination: "discord:bot-a" } });
    expect(second.discord?.queueDestination).toBe("discord:bot-b");
    expect(() => { assertDistinctBotConfigs([first, second]); }).not.toThrow();
    expect(() => { assertDistinctBotConfigs([first, { ...second, botId: "bot-a" }]); }).toThrow("BOT_ID");
    expect(() => { assertDistinctBotConfigs([first, { ...second, discord: firstDiscord }]); }).toThrow("DISCORD_QUEUE_DESTINATION");
    await scope.close();
  });

  it("loads a bot persona without adding experiential state or a user address", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, `${required}BOT_PERSONA_FILE=persona.yaml\n`);
    await writeFile(`${cwd}/persona.yaml`, `version: 1\nidentity:\n  displayName: アオ\ncommunication:\n  language: ja\n  firstPerson: 僕\n  tone: [明るい]\n  responseStyle: [簡潔に話す]\n  avoid: []\n`);
    const config = await loadConfig({ cwd, environment: {} });
    expect(config.persona).toEqual({ version: 1, identity: { displayName: "アオ" }, communication: { language: "ja", firstPerson: "僕", tone: ["明るい"], responseStyle: ["簡潔に話す"], avoid: [] } });
    expect(config.persona).not.toHaveProperty("userAddress"); expect(config.persona).not.toHaveProperty("roles");
    await scope.close();
  });

  it("uses the conventional persona path and rejects an invalid configured persona", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required); await mkdir(`${cwd}/config/personas`, { recursive: true });
    await writeFile(`${cwd}/config/personas/sample.yaml`, `version: 1\nidentity: { displayName: Sample }\ncommunication: { firstPerson: I, tone: [calm] }\n`);
    await expect(loadConfig({ cwd, environment: {} })).resolves.toMatchObject({ persona: { identity: { displayName: "Sample" } } });
    await writeFile(`${cwd}/invalid.yaml`, `version: 1\nidentity: {}\ncommunication: {}\n`);
    await expect(loadConfig({ cwd, environment: { BOT_PERSONA_FILE: "invalid.yaml" } })).rejects.toThrow();
    await scope.close();
  });

  it("validates the bot:start argument and required Discord allowlist contract", async () => {
    expect(parseBotStartArguments([])).toEqual({});
    expect(() => parseBotStartArguments(["--unknown"])).toThrow("Usage");
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required);
    await expect(loadBotStartConfig([], { cwd, environment: {} })).rejects.toThrow("Discord configuration");
    await expect(loadBotStartConfig([], { cwd, environment: { DISCORD_BOT_TOKEN: "do-not-print", DISCORD_BOT_USER_ID: "user", DISCORD_CHANNEL_IDS: "channel" } })).rejects.toThrow("DISCORD_OWNER_IDS");
    await scope.close();
  });

  it("rejects invalid URLs, dimensions, mixed endpoints and partial Discord settings", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required);
    await expect(loadConfig({ cwd, environment: { SIMPLE_CLIENT_BASE_URL: "file:///tmp", OLLAMA_EMBEDDING_DIMENSION: "0" } })).rejects.toThrow();
    await expect(loadConfig({ cwd, environment: { OLLAMA_EMBEDDING_BASE_URL: "https://chat" } })).rejects.toThrow();
    await expect(loadConfig({ cwd, environment: { DISCORD_BOT_TOKEN: "token" } })).rejects.toThrow();
    await scope.close();
  });

  it("redacts secrets recursively", () => {
    expect(redactSecrets({ OLLAMA_API_KEY: "key", nested: { discordToken: "token", safe: "yes" } })).toEqual({ OLLAMA_API_KEY: "[REDACTED]", nested: { discordToken: "[REDACTED]", safe: "yes" } });
  });

  it("provides deterministic clock and IDs", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); clock.advance(1_000);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:01.000Z");
    const ids = new SequenceIdGenerator(["one"]); expect(ids.next()).toBe("one"); expect(() => { ids.next(); }).toThrow("exhausted");
  });

  it("enforces lifecycle transitions and refuses new work while stopping", () => {
    const lifecycle = new ProcessLifecycle(); expect(() => { lifecycle.assertAccepting(); }).toThrow();
    lifecycle.transition("ready"); lifecycle.assertAccepting(); lifecycle.transition("degraded"); lifecycle.transition("stopping");
    expect(lifecycle.signal.aborted).toBe(true); expect(() => { lifecycle.assertAccepting(); }).toThrow(); lifecycle.transition("stopped");
  });
});
