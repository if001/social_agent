---
created_at: 2026-11-15
status: done
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

- [x] FR-12 / FR-13：idleが探索後にflat schemaの最終Actionを返せる。
- [x] NFR-4：system prompt、model view、Tool schema、output schemaのtoken内訳を記録する。
- [x] NFR-21：G3 taskの失敗recordだけでprovider、schema、Tool、timeout又は予算を判別できる。
- [x] FR-51 / FR-52：`needsG3: true`からG3 task完了、`prediction-g3-result` Event、通常Agent Loopまで実行される。

## Tests

- FR-12 / FR-13：idleの探索後final ActionとTool-free終端をsystem testする。
- NFR-4：model input budgetの構成要素とEvent skill別上限をunit testする。
- NFR-21：G3 provider / schema / Tool失敗の分類とcause保存をintegration testする。
- FR-51 / FR-52：実PostgreSQLと実LLMでG3 taskからresult Eventまでをlive testする。

## 上流への反映

- 不要：既存のFR-12、FR-13、FR-51、FR-52、NFR-4、NFR-21で要求済み。

## 実装メモ

- idle失敗Runの計測では、system promptは約901 token、flat output schemaは約417 token、Tool schema群は約4,936 tokenだった。過剰な出力fieldではなく、探索が25 Tool callまで進んだ後にfinal structured outputへ移るmodel-call枠が1回しかないことが主因だった。
- total model-call budget内に、Tool-free finalizationとschema repairの2 callを予約する。G3にも同じ境界を適用する。
- G3 taskのfailure reasonには、top-level wrapperだけでなく、sanitize済みのerror code/message/cause chainを保存する。
- G3の`memories[].content`と`reason`へdescriptionを追加し、4つの出力配列を常に返すようpromptで明示した。
- 実LLM・隔離した実PostgreSQLでG3 taskの正常系を確認した。不要なDeepAgent file ToolをG3から隠し、`memories[].target` / `perspective` の許可値をprompt・repair指示へ明記した結果、`g3_tasks.status=completed` と構造化出力の保存まで到達した。
- `user-message`後のPredictionLoopは`needsG3`時にsource Event / Run / Predictionを持つtaskをenqueueする。完了後はCompositionのresult sinkが`prediction-g3-result`をRuntimeへ渡し、ContextLoaderがG3 outputを`predictionContext`へ変換して通常Agent Loopに渡す。G3 task、result Event、通常Loopのtimeoutはすべて`config.runDeadlineMs`へ統一した。
- FR-52の「通知必須」はFR-76およびEvent overviewと矛盾していたため、発話任意へ要件・Architecture・Motivation Modelを統一した。実装どおり、通常Loopが`no-external-action`を選べる。
- 検証：`pnpm test`（240 passed）、`pnpm test:system`（58 passed）、`pnpm typecheck`、実LLM・隔離実PostgreSQLのG3 task正常系。`trace_check`はERROR 0、既存の要件テスト不足WARN 7件。
