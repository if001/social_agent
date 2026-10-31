---
created_at: 2026-10-29
status: done
type: change
plan: []
requirements: [C-30, C-43, C-48, C-55, C-59, C-65, C-66, C-67, C-70, FR-48, FR-49, FR-50, FR-51, FR-52, FR-53, FR-54, FR-55, FR-56, FR-57, FR-58, FR-59, FR-60, FR-61, FR-62, FR-63, FR-64, NFR-14, NFR-15, NFR-16, NFR-17, NFR-18, NFR-19, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18]
requires: agent
---

# 008 予測・予測誤差・背景経験の設計をspecとdocsへ反映する

起点：`docs/work/analyze/2026-10-29-docs.md`、`spec/prediction-error-design.md`、2026-10-29の会話。

## Background

予測Loop、G1〜G3、predictionEvaluationとFeelingの分離、MemoryIntent、MemoryUpdate Event、Background Experience、Reflectionの部分成功を設計した。設計は`spec/prediction-error-design.md`と下流docsへ反映済みだが、変更Issueとして差分・影響範囲・上流反映を記録し、`spec-analyze`で確認する必要がある。

## Dependencies

なし。

## Scope

- `spec/prediction-error-design.md`のC-30〜C-70を追加する。
- C-10を、会話由来MemoryとBackground Experienceを別Storeに保持する形へ更新する。
- `docs/REQUIREMENTS.md`へR9、FR-48〜FR-64、NFR-14〜NFR-19、AC-11〜AC-18を追加する。
- `docs/ARCHITECTURE.md`へADR-12〜ADR-19、予測Loop、MemoryUpdate Event、共通Retrieval、Background Experience、Reflection部分成功を追加する。
- `docs/AGENT_MOTIVATION_MODEL.md`へ予測誤差と感情・動機、MemoryIntent、MemoryUpdate Event、Background Experienceを追加する。
- `docs/TEST_STRATEGY.md`へ追加設計のtest layerと要件対応を追加する。

## Out of scope

- 実装コード、DB migration、test fileの追加。
- Background Experienceの100件データ生成（010）。
- G1/G2、MemoryWriteService、MemoryUpdate Event、G3、Reflectionの実装（011〜015）。

## Implementation notes

- spec変更はユーザー承認済みとして扱う。
- 作業ツリーには既にspec/docs更新が含まれる。残作業は`trace_check.py`、`spec-analyze docs`、`spec-analyze change`、およびコミット。
- 追加設計の実装は011〜016へ分割する。

## Acceptance criteria

- [x] AC-11：predictionEvaluationとFeelingの分離がdocsへ反映されている。
- [x] AC-12：MemoryWriteServiceとMemory versionの要件がdocsへ反映されている。
- [x] AC-13：memory-update Eventの専用Handlerと冪等性がdocsへ反映されている。
- [x] AC-14：Background Experienceの別Storeと共通Retrievalがdocsへ反映されている。
- [x] AC-15：Reflectionの部分成功と再試行がdocsへ反映されている。
- [x] AC-16：G3の別DeepAgentと通知例外がdocsへ反映されている。
- [x] AC-17：MemoryIntentのtarget限定がdocsへ反映されている。
- [x] AC-18：予測Loopが旧後処理ではないこととcall予算がdocsへ反映されている。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて「反映済み」または「不要」になっている。
- [x] `trace_check.py`でERROR 0件。
- [x] `spec-analyze change`でdocs範囲のCRITICALが0件。

## Tests

- AC-11, AC-13：`trace_check.py`が新しいC/FR/NFR/AC/ADR IDを解決できる。
- AC-14, AC-18：`spec-analyze docs`で3文書のCRITICALが0件。
- AC-12, AC-15, AC-16, AC-17：`spec-analyze change`で変更範囲のCRITICALが0件。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | C-30〜C-70 | 予測、MemoryIntent、MemoryUpdate Event、Background Experience、共通Retrieval、Reflection部分成功 | spec/prediction-error-design.md |
| MODIFIED | C-10 | 会話由来MemoryとBackground Experienceを別Storeに保持する | spec/personal-agent-concept-design-restructured-v2.md |
| ADDED | FR-48〜FR-64 | 予測Loop、G3、Background Experience、MemoryWriteService、memory-update Event | docs/REQUIREMENTS.md |
| ADDED | NFR-14〜NFR-19 | 所有権・budget、version、deadline、監査、優先順位、背景経験検証 | docs/REQUIREMENTS.md |
| ADDED | AC-11〜AC-18 | 追加設計の受入条件 | docs/REQUIREMENTS.md |
| ADDED | ADR-12〜ADR-19 | 予測Loop、G3、Retrieval、MemoryWriteService、Event優先順位、Reflection、table | docs/ARCHITECTURE.md |
| MODIFIED | Memory / Background Experience / 予測Loop | 予測誤差、MemoryIntent、MemoryUpdate Event、Background Experience | docs/AGENT_MOTIVATION_MODEL.md |
| MODIFIED | test layers / 要件対応 | 追加設計のtest layerとFR/NFR/AC対応 | docs/TEST_STRATEGY.md |
| MODIFIED | Memory型 / Background Experience Store / Retrieval | 会話由来Memoryと背景経験の分離 | spec/personal-agent-implementation-design-v2.md |

## 影響範囲

検索した語：C-10、C-30、C-70、FR-48、MemoryIntent、MemoryUpdate、Background Experience、predictionEvaluation、Reflection

| 場所 | 内容 | 対応 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md | C-10とMemory節 | 更新済み |
| spec/personal-agent-implementation-design-v2.md | Memory型、Background Experience Store、Retrieval | 更新済み |
| spec/prediction-error-design.md | 新規設計 | 追加済み |
| docs/REQUIREMENTS.md | R9、FR/NFR/AC | 更新済み |
| docs/ARCHITECTURE.md | ADR、実行境界、Loop、Event、Domain、Module | 更新済み |
| docs/AGENT_MOTIVATION_MODEL.md | 予測誤差、MemoryIntent、Event、Background Experience | 更新済み |
| docs/TEST_STRATEGY.md | 追加設計のtest layerと対応表 | 更新済み |
| docs/work/analyze/2026-10-29-docs.md | 整合性レポート | 作成済み |
| docs/work/analyze/2026-10-31-change-008.md | 変更レビュー | 作成済み |
| spec/prediction_error.md | 旧noteの削除。008のScope外 | 変更しない |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-10 | 会話由来MemoryとBackground Experienceの分離 | 反映済み |
| spec/prediction-error-design.md C-30〜C-70 | 予測Loop、MemoryIntent、MemoryUpdate Event、Background Experience、Reflection | 反映済み |
| spec/personal-agent-implementation-design-v2.md | Memory型、Background Experience Store、共通Retrieval | 反映済み |
| docs/REQUIREMENTS.md | FR-48〜FR-64、NFR-14〜NFR-19、AC-11〜AC-18 | 反映済み |
| docs/ARCHITECTURE.md | ADR-12〜ADR-19と実行境界 | 反映済み |
| docs/AGENT_MOTIVATION_MODEL.md | 予測誤差、MemoryIntent、Event、Background Experience | 反映済み |
| docs/TEST_STRATEGY.md | 追加設計のtest layerと対応表 | 反映済み |

## 実装メモ

- spec/docsの変更は作業ツリーへ反映済み。
- `trace_check.py`はERROR 0件。WARN 17件/INFO 20件はFR-48〜FR-64、AC-11〜AC-18のテスト未実装による。
- 変更レビューは`docs/work/reviews/2026-10-31-issue-008.md`。独立レビューでCRITICAL/HIGH 0件、MEDIUM 6件をIssue内で修正した。
- `docs/work/analyze/2026-10-31-change-008.md`に変更分析を記録した。
- `issues/009〜016`、`docs/work/note/`、`2026-10-25`のレポート、`spec/prediction_error.md`の削除は008のコミットに含めない。
