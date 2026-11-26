import { loadConfig } from "../../src/config/config.js";
import { createOllamaObservationGateModel } from "../../src/infrastructure/agent/observation-gate-model.js";

describe("live Ollama Observation Gate", () => {
  it("FR-91: ignores agreement-only follow-ups and engages a concrete new peer question", async () => {
    const model = createOllamaObservationGateModel((await loadConfig()).chat);
    const base = {
      peerName: "aka",
      self: { disposition: "気になる食い違いを放っておけない", story: "議論の差分を調べるのが好きだが、礼儀だけで会話を続けない" },
      mood: { updatedAt: "2026-01-01T00:00:00.000Z", levels: {} },
      relationship: "意見が食い違うと議論は面白いが、合意した話を蒸し返す必要はない",
      concerns: ["出典が変わる過程に実際の差分があるか確かめたい"],
      memories: ["akaとは二重タグ案を採用し、次は23日に比較するだけと確認した"],
      recentSelfSpeech: "二重タグを採用すれば、23日は比較だけで決着すると思う"
    };
    const signal = AbortSignal.timeout(300_000);
    await expect(model.decide({ ...base, text: "うん、その二重タグ案でいこう。23日は比べるだけだね。" }, signal)).resolves.toMatchObject({ decision: "ignore" });
    await expect(model.decide({ ...base, text: "二重タグ案は採用する。ただ、今朝の一次資料では片方のタグが消えていた。どの更新で消えたのか追える？" }, signal)).resolves.toMatchObject({ decision: "engage" });
  }, 310_000);
});
