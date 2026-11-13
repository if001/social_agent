---
created_at: 2026-11-13
status: done
type: fix
plan: []
requirements: [FR-42, FR-73, NFR-7, NFR-17]
requires: agent
---

# 029 Reconciliation候補を後続EventのあるMemoryへ限定する

起点：2026-11-13のReflection実行で、後続Eventを持たない既存Memoryが
Reconciliation anchorに選ばれ、保存時の時系列検証で失敗した。

## Background

Memory Reconciliationは後続Eventに基づき既存Memoryを補強、訂正または分割する。
後続EventがないMemoryを候補に含めると、Reflectorに有効な更新根拠がなく、
commit層が拒否する出力を誘発する。

## Dependencies

- 028（再活性化ベースのMemory Reconciliation）

## Scope

- Reconciliation anchorを、episodic以外かつ当該Memoryより後の確定Eventを持つものに限定する。
- Memory Formationの出力に最大4件の選別規則を明記する。
- 候補除外と、5件の初回出力を4件へ修復する回帰テストを追加する。

## Out of scope

- Reflection対象数・Memory batch数の変更。
- 保存済みMemoryまたはEventの書換え。
- 実LLM試験を通常のverifyへ含める変更。

## Acceptance criteria

- [x] FR-73：後続Eventを持たないMemoryとepisodic MemoryはReconciliation anchorにならない。
- [x] FR-42：Memory Reflectorは候補が5件以上なら重要度順の4件だけを構造化出力するよう明記される。
- [x] FR-42, NFR-7：5件の初回出力がrepair後に4件の有効出力としてcommit可能である。
- [x] NFR-17：実DB回帰テストで候補選定と時系列整合性を検証する。

## Tests

- FR-73：後続Eventなし・episodic・後続EventありのMemoryを混在させ、最後だけがanchorになる。
- FR-42：5件のMemory出力を返すReflectorが、repairで4件の出力へ収束する。
- FR-42：Memory Skillとschema descriptionに最大4件・候補の選別がある。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | なし。既存の後続根拠制約の実装詳細 | 不要 |
| `docs/ARCHITECTURE.md` | なし。既存の「後続根拠による訂正だけ」と整合 | 不要 |

## 実装メモ

- `postgres-reflection.ts` は、固定Event窓内に後続のcompleted Eventを持つ非episodic Memoryだけをanchor候補にする。
- unit: `tests/unit/reflection-harness.test.ts` は5件から4件へのrepairを確認した。
- integration: `tests/integration/persistence.test.ts` の回帰ケースは実PostgreSQLで通過した。スイート全体の3件のbackoff失敗は、ユーザーのdebug用`delay=0`変更による既知差分である。
- live: `tests/live/ollama-targeted-reflection.test.ts` を追加した。`.env`読取りを伴うため今回の作業では未実行。
- 変更分析: `docs/work/analyze/2026-11-13-change-029.md`。
