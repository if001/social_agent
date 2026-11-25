---
created_at: 2026-11-25
status: done
type: fix
plan: []
requirements: [FR-24, FR-82, NFR-7, NFR-8]
ui: []
requires: agent
---

# 090 復元不能な旧derive Concern proposalをIntegration読取りから除外する

## Background

旧Runのderive Concern proposalは、現在Runtimeが付与する`derivationReason`と`evidenceMemoryIds`を持たない。Experience Integrationは当該proposalを再commit・再配送・再派生に使わず、完了済みsource RunのEvent経験を統合する。そのため、根拠を捏造して現行proposalへ変換せず、歴史的Runの読取り時だけ復元不能な旧derive proposalを除外する必要がある。

実LLM・実DB live testは現行schemaの新規Runを一時DBで生成するため、旧JSONを持つpending / failed Integrationの再開を検出しない。これは実DB persistence integration testで固定する。

## Dependencies

- Issue 078（done）
- Issue 080（done）
- Issue 089（done）

## Scope

- 既知の旧derive proposal（旧sourceConcernId形式で、現行Runtime根拠・派生理由を持たないもの）だけをExperience Integrationの復元結果から除外する。
- 有効な現行proposalと、`reconsiderAt`だけを含む旧create proposalは復元する。
- 実DB integration testに、旧derive proposalを含むfailed Integrationの復元を追加する。

## Out of scope

- 欠落した`derivationReason`・`evidenceMemoryIds`の推測、生成、DB書込み。
- 現行schemaを緩めること、過去RunやConcern Activityの書換え。
- 実LLMが旧形式を出力することを期待するlive test。

## Acceptance criteria

- [x] FR-82, NFR-7：旧derive proposalを含むfailed Integrationを復元し、Event経験統合を再開できる。`tests/integration/persistence.test.ts`。
- [x] NFR-8：除外対象は既知の旧derive schemaだけであり、未知fieldを一般的に除去して受理しない。限定legacy schemaのstrict parseを通す。
- [x] FR-24：欠落した根拠・派生理由を推測せず、Schedule / Signal / Concernを再生成しない。復元はRun結果の読取りだけである。
- [x] 現行proposal、旧`reconsiderAt` create proposal、旧Action互換読取りを回帰させない。`tests/integration/persistence.test.ts`。

## Tests

- FR-82, NFR-7：実DB integration testで、旧derive proposalを含むRun resultを復元する。
- FR-24, NFR-8：復元結果に旧derive proposalはなく、現行proposalと正規化可能な旧create proposalだけが残ることを確認する。

## 上流への反映

- 不要。現行のRuntime根拠解決とstrict schemaを維持し、完了済みRunの読取り投影だけを互換化する。

## 実装メモ

- 旧derive proposalは旧`sourceConcernId`、description、whyItMatters、任意の探索方向・transitionだけを持つstrictな既知形式に一致した場合だけ読取り投影から除外する。
- `derivationReason`と`evidenceMemoryIds`はRuntimeが当時解決して保存すべき根拠であり、ここでは補完しない。
- 実LLM・実DB live testは新規一時DBと現行schemaのRunを検証するため、旧JSONの再開互換を検出しない。回帰は実DB persistence integration testに追加した。
- 検証：`pnpm test:integration -- tests/integration/persistence.test.ts`（76件）、`pnpm typecheck`、`pnpm lint`、ID trace check（ERROR 0、既存WARN 8）。
- レビュー：`docs/work/reviews/2026-11-25-issue-090.md`。要件・受入条件に関わる未解決指摘なし。
