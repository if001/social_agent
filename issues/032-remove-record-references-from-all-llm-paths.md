---
created_at: 2026-11-13
status: done
type: feature
plan: []
requirements: [FR-77, FR-82, FR-83, FR-84, FR-85, NFR-7, NFR-21, NFR-22]
requires: agent
---

# 032 全LLM経路から永続Record参照を除去する

起点：Issue #031 の独立レビュー。#031 はReflection専用に限定した。

## Dependencies

- 031

## Scope

- Experience Integration、G1/G2、G3、Agent Core の入力schema、構造化出力schema、repair入力、promptから永続Record IDと局所参照を除去する。
- Runtimeが自然言語候補と固定範囲・検索結果から対象と根拠を解決する。
- 各経路のLLM-facing payloadを検査するcontract testを追加する。

## Out of scope

- ReflectionのFormation/Reconciliation resolver。Issue #031が担当する。

## Acceptance criteria

- [x] FR-77：全LLM経路の通常入力、構造化出力、repair入力にcanonical ID・局所参照・cursorが現れない。
- [x] FR-77：Runtimeだけが対象・根拠・所有権を解決して保存する。
- [x] NFR-7：Runtime解決したcanonical根拠だけを監査に保存する。
- [x] NFR-21/NFR-22：候補収集・機械的制約はRuntime、自然言語判断はLLMに分離する。

## Detailed design

- 全LLM adapterはcanonical recordをID-free viewへ射影し、Runtimeだけが非公開handleとcanonical recordの対応を持つ。repair payloadとinvalid outputも同じ射影を通す。
- Experience Integrationはsource Eventを唯一の直接根拠とし、Relationshipは当該actorへ暗黙に束縛する。LLMは本文と自然言語の理由だけを返す。
- G1/G2は予測とG3起動判断だけを返す。Memory / observation candidateを出力しない。
- G3は仮説・findings・Memory候補を返す。Runtimeはsource Eventと同RunのTool evidence pool内に限定したHybrid Retrievalで根拠を解決する。
- Agent CoreはAssessment / Desire / Actionだけを出力する。repairのallowed evidence IDを廃止し、ConcernはRuntime検証されるTool経由だけで扱う。

## Tests

- FR-77：各LLM adapterの通常・repair payloadをfixtureで検査する。
- FR-77/NFR-7：foreign/unknown候補をRuntimeがcommitしないことを検証する。
