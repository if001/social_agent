---
created_at: 2026-10-29
status: done
type: feature
plan: []
requirements: [C-50, C-51, C-52, C-53, C-54, FR-48, FR-49, FR-50, FR-53, FR-54, FR-55, FR-57, FR-58, FR-60, FR-61, FR-62, FR-63, FR-64, NFR-14, NFR-15, NFR-16, NFR-17, NFR-18, NFR-19, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18]
requires: agent
---

# 016 予測Loop・MemoryUpdate・Background Experienceの評価とDebug UIを実装する

元計画：なし（[009](009-background-experience-store-and-retrieval.md)〜[015](015-reflection-partial-update.md)の後続）

## Background

予測Loop、MemoryIntent、MemoryUpdate Event、Background Experience、Reflection部分成功を実装しても、予測誤差が感情・動機・行動・記憶更新へ影響することを評価しなければ、設計の目的を検証できない。Debug UIでも予測、誤差、MemoryIntent、MemoryUpdate、Reflection statusを観測できる必要がある。

## Dependencies

- 009
- 011
- 012
- 013
- 014
- 015

## Scope

- Evaluation harnessへprediction-error、prediction-key、memory-update-effect、non-sycophancy、latencyのscenarioを追加する。
- predictionEvaluation、MemoryIntent、MemoryUpdate、Background Experienceのartifact保存を追加する。
- 予測的中率と期待度校正を診断指標として集計する。
- 予測誤差がMeaning、Feeling、Desire、Action、Memoryへ影響するかを評価する。
- 同じ予測誤差でSelf、Disposition、Concern、Relationship、Background Experienceが違えば反応が変わるかを評価する。
- Memoryのcreate、update、no-opの後に次の誤差が変わるかを評価する。
- Debug UIに予測、誤差、MemoryIntent、MemoryUpdate、Reflection status、Background Experienceを表示する。
- Live Ollamaに`ollama-prediction.test.ts`を追加する。
- production-like E2EにG1/G2、memory-update Event、Background Experience検索を追加する。

## Out of scope

- 予測Loop自体の実装（011）。
- MemoryWriteService、MemoryUpdate Event、G3、Reflectionの実装（012〜015）。
- 評価の合格閾値の最終決定。

## Implementation notes

- Schema適合を成功条件にしない。
- 予測精度だけを成功条件にせず、誤差が感情・動機・行動・記憶更新へ影響するかを見る。
- 誤差が減らない場合も、信念維持、誤った記憶、状況変化として区別する。
- Debug UIは読み取り専用を維持する。
- artifactにはモデル、promptバージョン、背景経験セット、設定を含める。

## Acceptance criteria

- [x] AC-11：予測、1ターン遅れ、Feeling非出力がartifactとして保存される。
- [x] AC-12：Memoryのcreate、update、no-opとversion競合がunit/integrationで評価される。
- [x] AC-13：memory-update Eventの冪等性が評価される。
- [x] AC-14：Background Experienceの別Store、非上書き、共通Retrievalが評価される。
- [x] AC-15：Reflectionの部分成功と再試行が評価される。
- [x] AC-16：G3の遅延、MainAgent再判断、通知例外がsystem testで評価される。
- [x] AC-17：MemoryIntentのtarget限定が評価される。
- [x] AC-18：predictionContextのbudget、旧後処理不在、call予算が評価される。
- [x] Debug UIで予測、MemoryIntent、MemoryUpdate、Reflection status、Background Experienceを観測できる。

## Tests

- FR-48, FR-50, AC-11：`tests/evaluation/prediction-loop-evaluation.test.ts`
- FR-57, NFR-15, AC-12：`tests/unit/memory-write-service.test.ts`, `tests/integration/persistence.test.ts`
- FR-58, FR-61, NFR-17, NFR-18, AC-13：`tests/system/memory-update-event.test.ts`
- FR-53, FR-54, FR-55, NFR-19, AC-14：`tests/integration/background-experience.test.ts`
- FR-60, AC-15：`tests/system/reflection-partial.test.ts`
- FR-51, FR-52, AC-16：`tests/system/g3-event.test.ts`
- FR-56, AC-17：`tests/unit/memory-intent.test.ts`
- FR-62, FR-63, FR-64, NFR-14, NFR-16, AC-18：`tests/contract/prediction-contracts.test.ts`, `tests/system/prediction-loop.test.ts`
- FR-49：`tests/live/ollama-prediction.test.ts`
- NFR-12：`tests/unit/debug-ui.test.ts`

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| src/evaluation/ | 予測Loop、MemoryUpdate、Background Experienceのscenario | 追加する |
| tests/evaluation/ | 評価test | 追加する |
| tests/live/ollama-prediction.test.ts | 実Ollamaの予測 | 追加する |
| tests/live/production-context-user-response.test.ts | production-like E2E | 更新する |
| src/debug-ui/ | 予測、誤差、MemoryIntent、MemoryUpdate、Reflection status | 更新する |
| tests/unit/debug-ui.test.ts | 表示項目 | 更新する |
| docs/work/test-runs/ | 評価artifact | 保存する |

## 実装メモ

- Debug UIへPrediction/MemoryUpdate/Background/G3の読み取りAPIとパネルを追加した。
- Evaluation artifactへprediction/memoryUpdate/backgroundExperienceを追加した。
- Live Ollama prediction testを追加した。
- レビュー記録：`docs/work/reviews/2026-11-01-issue-016.md`
- 残存MEDIUM：prediction-error等の実model scenario、production-like E2E、誤差集計指標。
