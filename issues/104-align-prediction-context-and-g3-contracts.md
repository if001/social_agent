---
created_at: 2026-11-27
status: complete
type: change
plan: []
requirements: [FR-48, FR-49, FR-51, FR-52, FR-62, FR-83, FR-84, NFR-14, NFR-16, NFR-20]
requires: agent
---

# 104 Prediction Context とG3契約の一次仕様・実装を整合する

元計画：[G1/G2・G3 契約レビュー](../docs/work/analyze/2026-11-27-g1-g3-contract-review.md)

## Background

レビューで、予測系に四つの不整合が見つかった。

1. 一次仕様 `spec/prediction-error-design.md` が、廃止済みの `remember` /
   `observationCandidates` と旧G3 MemoryIntent経路を記載している。
2. `PredictionRepository.context(agentId)` が subject を受けず、複数の相手との
   予測を同じAgentのContextへ混在させ得る。
3. G1/G2 prompt は Agent応答も観測すると説明するが、Prediction service の
   `result` はPrediction model入力に渡されず、Action effect の対象が曖昧である。
4. Main Agent のprompt / skillが predictionContext とG3結果をどう扱うかを
   明示していない。

Predictionは個体のFeeling・Desire・Actionを直接決めるものではなく、相手との
経験に対する予想とずれを、Agentが次の判断で任意に使える補助信号とする。

## Dependencies

- なし

## Scope

- 一次仕様とRequirementsを、現行の「G1/G2はMemoryを直接決めず、G3はfinding / hypothesis
  だけを返し、結果は通常 Agent LoopとExperience Integrationで扱う」経路へ整合する。
- Prediction Contextを `agentId + subjectId` で復元し、相手が解決できないEventでは
  他subjectのPredictionを渡さない。
- G1/G2入力を、現在のdirect入力、同subjectの前回Prediction、前回応答の結果、
  限定Memory候補として明文化・実装する。
- Main Agentの共通promptと `prediction-g3-result` 用skillを追加し、予測誤差は
  Feelingを強制せず、事実・未確定仮説・現在の動機として区別して扱わせる。
- subject分離、前回応答入力、prediction-g3-resultのskill routeをContract/System
  testで確認する。

## Out of scope

- `prediction_evaluations` tableとPrediction JSONの重複解消。
- 旧Prediction JSON / 旧G3 task互換readerの削除。
- G3仮説の長期正本・再評価機構。

## 差分

| 種別 | ID | 内容 | 文書 |
| --- | --- | --- | --- |
| MODIFIED | C-34〜C-42 | G1/G2とG3の入出力・Memory経路を現行責務へ訂正する | spec/prediction-error-design.md |
| MODIFIED | C-51, C-62, C-66 | predictionContextをsubject所有とし、G3結果の渡し方を訂正する | spec/prediction-error-design.md |
| MODIFIED | FR-48, FR-51, FR-62, FR-84 | 同subjectのContext、前回応答、G3結果の通常Loop/Integration経路を明記する | docs/REQUIREMENTS.md |
| ADDED | FR-96 | predictionContextとG3結果をFeeling強制なしに扱うMain Agentの判断規則 | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`PredictionRepository.context`、`predictionContext`、`previousPrediction`、
`prediction-g3-result`、`G3OutputSchema`、`PredictionModelInput`。

| 場所 | 内容 | 対応 |
| --- | --- | --- |
| `src/application/prediction.ts` | Context / Model inputのport | 更新する |
| `src/application/prediction-loop.ts` | subjectと前回応答の受渡し | 更新する |
| `src/infrastructure/persistence/postgres-prediction-repository.ts` | subject scoped context | 更新する |
| `src/infrastructure/persistence/postgres-agent-context-loader.ts` | subjectをContextへ渡す | 更新する |
| `src/infrastructure/agent/prediction-harness.ts` | 実入力とpromptの整合 | 更新する |
| `src/infrastructure/agent/deep-agent-prompt.ts` | predictionContextの判断規則とskill route | 更新する |
| `skills/` | G3結果の扱い | 追加する |
| `tests/**prediction*`, `tests/system/g3-event.test.ts` | Contract / system検証 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
| --- | --- | --- |
| `spec/prediction-error-design.md` | C-34〜C-42、C-51、C-62、C-66の整合 | 反映済み |
| `docs/REQUIREMENTS.md` | FR-48、FR-51、FR-62、FR-84、FR-96 | 反映済み |

## Implementation notes

- 前回応答は、Predictionを作ったsource Runの確定ActionをRuntimeが取得して渡す。
  `PredictionServiceInput.result`（今回のAction）はG1/G2の評価対象ではないため、
  portから削除する。
- subjectを持たないinternal / autonomous EventはPrediction Contextを取得しない。
- G3結果用skillはfindingを確認済み根拠、hypothesisを未確定の解釈として扱う。
  どちらも発話・保存・Feelingを義務付けない。

## Acceptance criteria

- [x] FR-48：同じsubjectの前回PredictionだけがG1/G2評価とMain Agent Contextへ入る。
- [x] FR-48：前回応答はPrediction source Runから復元され、今回のActionを予測入力へ混ぜない。
- [x] FR-51 / FR-84：G3結果は通常Loopへ入り、G3自身は直接Memoryを確定しない。
- [x] FR-62 / FR-96：Main AgentはpredictionContextとG3結果を補助信号として扱い、Feeling・発話・保存を強制しない。
- [x] NFR-14：別subjectのPredictionがContextへ混入しない。
- [x] NFR-16 / NFR-20：Prediction / G3の構造化出力と入力契約をContract testで検証する。
- [x] 差分が正の文書に反映され、`spec-analyze` でCRITICAL / HIGHがない。

## Tests

- FR-48 / NFR-14：PostgreSQL Prediction repositoryがsubject別に履歴・Contextを分離するIntegration test。
- FR-48：Prediction Loopが前回Prediction source RunのActionだけをModel入力へ渡すSystem test。
- FR-51 / FR-84 / FR-96：G3 result Eventが専用skillを読め、事実・仮説・Actionの非強制をContract test。
- `pnpm typecheck`
- `pnpm test`
- `python3 .agents/skills/spec-analyze/scripts/trace_check.py --root . --format md`

## Verification

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、対象のPrediction / G3 system test、実DBの
  integration testは通過した。
- system suite全体には、本Issueの変更前からあるObservation GateのConversation candidate
  期待値不一致が1件残る。Prediction / G3 system testは通過している。
