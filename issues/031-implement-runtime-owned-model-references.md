---
created_at: 2026-11-13
status: created
type: feature
plan: []
requirements: [FR-77, NFR-7]
requires: agent
---

# 031 LLM出力のcanonical IDを局所参照へ移行する

元要件：[Issue 030](030-runtime-owned-model-references.md) のFR-77。

## Dependencies

- 030（FR-77）

## Scope

- Reflection Memory FormationのEvent根拠、Reconciliationのanchor / Event / Memory根拠、Concern / Self-MoodのMemory根拠を、LLM向け局所参照へ移行する。
- Runtimeだけが局所参照と所有・固定入力範囲を照合し、canonical IDへ解決して保存する。
- repair入力、Skill、schema description、Debug監査を局所参照へ更新する。
- canonical IDをLLM入力schema・構造化出力schemaから除去する。

## Out of scope

- DB上の既存canonical ID列の廃止。
- Tool内部のRuntime所有IDや監査IDの変更。

## Acceptance criteria

- [ ] FR-77：全ReflectorのLLM入出力にcanonical Event / Memory / Concern IDが現れない。
- [ ] FR-77：局所参照は対象入力ごとにRuntimeが生成し、許可範囲外は保存前に拒否する。
- [ ] NFR-7：解決後のcanonical根拠だけを監査・保存し、解決失敗は対象attemptへ残す。
- [ ] FR-42：repairも同じ局所参照表だけを使い、通常Toolを再実行しない。

## Tests

- FR-77：LLM-facing input / schemaがcanonical IDを含まない。
- FR-77：局所Event / Memory / Concern参照がcanonical IDへ正しく解決される。
- FR-77：未知・別対象・別Agentの局所参照はcommitしない。
- FR-42：範囲外canonical IDを返す旧出力は移行後のschemaで受理しない。
