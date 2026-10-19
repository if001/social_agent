import { mkdir, writeFile } from "node:fs/promises";

import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { assertDistinctBotConfigs, loadConfig } from "../../src/config/config.js";
import { loadBotStartConfig, parseBotStartArguments } from "../../src/bootstrap/bot-start.js";
import { loadPageIngestStartConfig, parsePageIngestStartArguments } from "../../src/bootstrap/page-ingest-start.js";
import { loadInitialSelfFile } from "../../src/config/initial-self.js";
import { loadExplorationDomainCatalog } from "../../src/config/exploration-domains.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { redactSecrets } from "../../src/observability/redaction.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

const required = `BOT_ID=sample\nPOSTGRES_URL=postgres://sample\nADMIN_POSTGRES_URL=postgres://admin\nSIMPLE_CLIENT_BASE_URL=http://web\nOLLAMA_BASE_URL=https://chat\nOLLAMA_API_KEY=sample-key\nOLLAMA_CHAT_MODEL=chat\nOLLAMA_EMBEDDING_BASE_URL=http://embedding\nOLLAMA_EMBEDDING_MODEL=embed\nOLLAMA_EMBEDDING_DIMENSION=768\n`;

describe("configuration and lifecycle", () => {
  it("FR-6: validates versioned Initial Self YAML separately from Persona", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope);
    const valid = `${cwd}/initial-self.yaml`;
    await writeFile(valid, `version: 1\nfamily:\n  id: family\n  name: Family\n  sharedDisposition: 共通の傾向\nagent:\n  id: ao\n  identity: アオ\n  initialDisposition: 技術を試すことが好きで、根拠のない断定は嫌い\n  selfNarrative: 経験を始めた\n  selfContinuity: 経験をつなぐ\n`);
    const loaded = await loadInitialSelfFile(valid);
    expect(loaded).toMatchObject({ family: { id: "family", baseInstruction: "" }, agent: { id: "ao" }, initialState: { concerns: [], relationships: [] } });
    expect(loaded.agent.initialDisposition).toContain("技術を試す");
    for (const legacyField of ["values", "interests", "preferences", "roles"]) {
      const path = `${cwd}/legacy-${legacyField}.yaml`;
      await writeFile(path, `version: 1\nfamily: { id: family, name: Family, sharedDisposition: 共通の傾向 }\nagent: { id: ao, identity: アオ, initialDisposition: 好奇心が強い, ${legacyField}: 古い値, selfNarrative: 経験を始めた, selfContinuity: 経験をつなぐ }\n`);
      await expect(loadInitialSelfFile(path)).rejects.toThrow();
    }
    await writeFile(`${cwd}/invalid-self.yaml`, `version: 1\nfamily: { id: family }\nagent: { id: ao }\n`);
    await expect(loadInitialSelfFile(`${cwd}/invalid-self.yaml`)).rejects.toThrow();
    await scope.close();
  });

  it("FR-6, FR-7: validates the committed Initial Self files", async () => {
    const [ao, aka, shiro] = await Promise.all([loadInitialSelfFile("config/initial-self/ao.yaml"), loadInitialSelfFile("config/initial-self/aka.yaml"), loadInitialSelfFile("config/initial-self/shiro.yaml")]);
    expect(ao.family).toEqual(aka.family);
    expect(ao.agent.initialDisposition).not.toBe(aka.agent.initialDisposition);
    expect(ao.agent.initialDisposition).toContain("坂本龍一");
    expect(ao.agent.initialDisposition).toContain("試さずに分かったつもり");
    expect(aka.agent.initialDisposition).toContain("エドワード・ホッパー");
    expect(aka.agent.initialDisposition).toContain("根拠のない断定");
    expect(ao.agent.initialDisposition).toContain("未来への期待を想像してわくわく");
    expect(aka.agent.initialDisposition).toContain("少し距離を感じ");
    expect(shiro.agent.initialDisposition).toContain("休日の過ごし方");
    expect(shiro.agent.initialDisposition).toContain("少しそわそわ");
    expect(ao.agent.initialDisposition).not.toContain("問いを一つ選び");
    expect(aka.agent.initialDisposition).not.toContain("複数の可能性を比べ");
    for (const config of [ao, aka, shiro]) {
      expect(config.agent).not.toHaveProperty("values");
      expect(config.agent).not.toHaveProperty("interests");
      expect(config.agent).not.toHaveProperty("preferences");
      expect(config.agent).not.toHaveProperty("roles");
    }
    expect(ao.agent).not.toHaveProperty("firstPerson");
    expect(aka.agent).not.toHaveProperty("tone");
  });

  it("FR-28: loads a broad and duplicate-free exploration domain catalog", async () => {
    const catalog = await loadExplorationDomainCatalog("config/exploration-domains.yaml");
    expect(catalog.topics.length).toBeGreaterThanOrEqual(100);
    expect(catalog.topics.length).toBeLessThanOrEqual(200);
    expect(new Set(catalog.topics).size).toBe(catalog.topics.length);
    expect(catalog.topics).toEqual(expect.arrayContaining(["古代メソポタミアの都市と粘土板記録", "人工知能の評価と限界", "発酵食品と微生物文化", "詩の韻律と声"]));
  });

  it("NFR-13: loads sample, then .env, then process overrides", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope);
    await writeFile(`${cwd}/.env.sample`, required); await writeFile(`${cwd}/.env`, "BOT_ID=local\nOLLAMA_CHAT_MODEL=local-model\n");
    const config = await loadConfig({ cwd, environment: { BOT_ID: "process" } });
    expect(config.botId).toBe("process"); expect(config.chat.model).toBe("local-model"); expect(config.embedding.dimension).toBe(768);
    expect(config.schedulerTimings).toEqual({ scanIntervalMs: 30_000, autonomyReviewIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000, retryDelayMs: 300_000, leaseMs: 60_000 });
    await scope.close();
  });

  it("FR-39, NFR-6: loads every autonomous schedule timing from environment", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required);
    const config = await loadConfig({ cwd, environment: { SCHEDULER_INTERVAL_MS: "1000", AUTONOMY_REVIEW_INTERVAL_MS: "2000", STATE_REVIEW_INTERVAL_MS: "3000", MEMORY_RECALL_INTERVAL_MS: "4000", SCHEDULER_RETRY_DELAY_MS: "7000", SCHEDULER_LEASE_MS: "8000", FILE_READ_ROOTS: "./read-a,./read-b", FILE_WRITE_ROOTS: "./write" } });
    expect(config.schedulerTimings).toEqual({ scanIntervalMs: 1000, autonomyReviewIntervalMs: 2000, stateReviewIntervalMs: 3000, memoryRecallIntervalMs: 4000, retryDelayMs: 7000, leaseMs: 8000 });
    expect(config.fileReadRoots).toEqual([`${cwd}/read-a`, `${cwd}/read-b`]); expect(config.fileWriteRoots).toEqual([`${cwd}/write`]);
    await scope.close();
  });

  it("NFR-1, NFR-10: loads process-specific bot files after .env and keeps bot destinations distinct", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope);
    await writeFile(`${cwd}/.env.sample`, required);
    await mkdir(`${cwd}/config`, { recursive: true });
    await writeFile(`${cwd}/config/exploration-domains.yaml`, `version: 1\ntopics:\n${Array.from({ length: 100 }, (_, index) => `  - exploration-topic-${String(index + 1)}`).join("\n")}\n`);
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

  it("FR-6: loads a bot persona without adding experiential state or a user address", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, `${required}BOT_PERSONA_FILE=persona.yaml\n`);
    await writeFile(`${cwd}/persona.yaml`, `version: 1\nidentity:\n  displayName: アオ\ncommunication:\n  language: ja\n  firstPerson: 僕\n  tone: [明るい]\n  responseStyle: [簡潔に話す]\n  avoid: []\n`);
    const config = await loadConfig({ cwd, environment: {} });
    expect(config.persona).toEqual({ version: 1, identity: { displayName: "アオ" }, communication: { language: "ja", firstPerson: "僕", tone: ["明るい"], responseStyle: ["簡潔に話す"], avoid: [] } });
    expect(config.persona).not.toHaveProperty("userAddress"); expect(config.persona).not.toHaveProperty("roles");
    await scope.close();
  });

  it("FR-6: uses the conventional persona path and rejects an invalid configured persona", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required); await mkdir(`${cwd}/config/personas`, { recursive: true });
    await writeFile(`${cwd}/config/personas/sample.yaml`, `version: 1\nidentity: { displayName: Sample }\ncommunication: { firstPerson: I, tone: [calm] }\n`);
    await expect(loadConfig({ cwd, environment: {} })).resolves.toMatchObject({ persona: { identity: { displayName: "Sample" } } });
    await writeFile(`${cwd}/invalid.yaml`, `version: 1\nidentity: {}\ncommunication: {}\n`);
    await expect(loadConfig({ cwd, environment: { BOT_PERSONA_FILE: "invalid.yaml" } })).rejects.toThrow();
    await scope.close();
  });

  it("NFR-10: validates the bot:start argument and required Discord allowlist contract", async () => {
    expect(parseBotStartArguments([])).toEqual({});
    expect(() => parseBotStartArguments(["--unknown"])).toThrow("Usage");
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required);
    await expect(loadBotStartConfig([], { cwd, environment: {} })).rejects.toThrow("Discord configuration");
    await expect(loadBotStartConfig([], { cwd, environment: { DISCORD_BOT_TOKEN: "do-not-print", DISCORD_BOT_USER_ID: "user", DISCORD_CHANNEL_IDS: "channel" } })).rejects.toThrow("DISCORD_OWNER_IDS");
    await scope.close();
  });

  it("NFR-10: loads page-ingest:start configuration from a process-specific file", async () => {
    expect(parsePageIngestStartArguments([])).toEqual({});
    expect(() => parsePageIngestStartArguments(["--unknown"])).toThrow("Usage");
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required);
    await writeFile(`${cwd}/.env.page-ingest`, "BOT_ID=ao\nDISCORD_BOT_TOKEN=secret\nDISCORD_BOT_USER_ID=bot\nDISCORD_OWNER_IDS=owner\nDISCORD_CHANNEL_IDS=pages\n");
    await expect(loadPageIngestStartConfig(["--env-file", ".env.page-ingest"], { cwd, environment: {} })).resolves.toMatchObject({ botId: "ao", discord: { botUserId: "bot", ownerIds: ["owner"], channelIds: ["pages"] } });
    await scope.close();
  });

  it("NFR-10: rejects invalid URLs, dimensions, mixed endpoints and partial Discord settings", async () => {
    const scope = new ResourceScope(); const cwd = await temporaryDirectory(scope); await writeFile(`${cwd}/.env.sample`, required);
    await expect(loadConfig({ cwd, environment: { SIMPLE_CLIENT_BASE_URL: "file:///tmp", OLLAMA_EMBEDDING_DIMENSION: "0" } })).rejects.toThrow();
    await expect(loadConfig({ cwd, environment: { OLLAMA_EMBEDDING_BASE_URL: "https://chat" } })).rejects.toThrow();
    await expect(loadConfig({ cwd, environment: { DISCORD_BOT_TOKEN: "token" } })).rejects.toThrow();
    await scope.close();
  });

  it("NFR-13: redacts secrets recursively", () => {
    expect(redactSecrets({ OLLAMA_API_KEY: "key", nested: { discordToken: "token", safe: "yes" } })).toEqual({ OLLAMA_API_KEY: "[REDACTED]", nested: { discordToken: "[REDACTED]", safe: "yes" } });
  });

  it("NFR-9: provides deterministic clock and IDs", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); clock.advance(1_000);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:01.000Z");
    const ids = new SequenceIdGenerator(["one"]); expect(ids.next()).toBe("one"); expect(() => { ids.next(); }).toThrow("exhausted");
  });

  it("NFR-6: enforces lifecycle transitions and refuses new work while stopping", () => {
    const lifecycle = new ProcessLifecycle(); expect(() => { lifecycle.assertAccepting(); }).toThrow();
    lifecycle.transition("ready"); lifecycle.assertAccepting(); lifecycle.transition("degraded"); lifecycle.transition("stopping");
    expect(lifecycle.signal.aborted).toBe(true); expect(() => { lifecycle.assertAccepting(); }).toThrow(); lifecycle.transition("stopped");
  });
});
