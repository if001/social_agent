---
created_at: 2026-11-15
status: doing
type: fix
plan: []
requirements: [FR-12, FR-13, FR-51, FR-52, NFR-4, NFR-21]
requires: agent
---

# 046 Agent構造出力の安定化とG3失敗監査

起点：#045の実DB全Event経路検証。

## Dependencies

- #044

## Scope

- idleを含むAgent Coreの入力、prompt、Tool schema、最終flat output schemaを計測する。
- 出力契約を保ったまま、過剰なschema又はprompt/contextを最小化する。
- Tool探索と最終structured-output toolのcall予算を分離し、最終Actionを返せるようにする。
- G3のprovider / schema / Tool失敗をtask failure reasonと監査に保存する。
- G3成功時に`prediction-g3-result` Eventまで到達することを検証する。

## Out of scope

- Agentの価値・感情・自律性の方針変更。
- #045の互換列・旧JSONのdrop。

## Implementation notes

- 実DBでidle Eventが`Final structured output could not be produced within the model call limit`により失敗した。
- G3 taskは`G3 provider failed`だけを残して`pending`へ戻り、原因を監査できなかった。

## Acceptance criteria

- [ ] FR-12 / FR-13：idleが探索後にflat schemaの最終Actionを返せる。
- [ ] NFR-4：system prompt、model view、Tool schema、output schemaのtoken内訳を記録する。
- [ ] NFR-21：G3 taskの失敗recordだけでprovider、schema、Tool、timeout又は予算を判別できる。
- [ ] FR-51 / FR-52：`needsG3: true`からG3 task完了、`prediction-g3-result` Event、通常Agent Loopまで実行される。

## Tests

- FR-12 / FR-13：idleの探索後final ActionとTool-free終端をsystem testする。
- NFR-4：model input budgetの構成要素とEvent skill別上限をunit testする。
- NFR-21：G3 provider / schema / Tool失敗の分類とcause保存をintegration testする。
- FR-51 / FR-52：実PostgreSQLと実LLMでG3 taskからresult Eventまでをlive testする。

## 上流への反映

- 不要：既存のFR-12、FR-13、FR-51、FR-52、NFR-4、NFR-21で要求済み。
