---
created_at: 2026-11-24
status: done
type: change
plan: []
requirements: [FR-24, FR-69, NFR-7, NFR-8]
ui: []
requires: agent
---

# 080 Concern Activityへ派生系譜を保存する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Dependencies

- #077 done

## Scope

- `concern_activities.source_concern_id`をDrizzle schemaとmigrationで追加し、derive Activityから親Concernを参照する。
- Activityに子Concern、trigger Event / Memory根拠、派生理由を監査可能に保存する。
- create / derive writer、repository、Debug read modelを更新する。Concern表へ親IDを複製しない。

## Acceptance criteria

- [x] AC-080-1：derive Activityから親Concernと子Concernを一意に追跡できる。
- [x] AC-080-2：derive以外のActivityはsource concernを持たない。
- [x] AC-080-3：migration後も既存ActivityとConcern履歴を失わない。

## Tests

- FR-69, NFR-7：derive commitが親・子・根拠を同一transactionで監査保存する。
- NFR-8：migrationを適用しても既存Concern / Activityが参照可能である。

## 実装詳細

`source_concern_id`だけでは親子関係を保存できるが、Scopeの「trigger Event / Memory根拠、派生理由を監査可能に保存する」ための不変値が未決である。

- trigger Eventは既存`event_id`で足りる。
- Memory根拠は既存`evidence_memory_ids`へ、`concern_due_focus`が選んだsignal Memory群をRuntimeがID非露出で引き継いで保存する案がある。
- 派生理由は子Concernの`why_it_matters`と意味が異なる可能性がある。Activityの不変`reason`列を追加し、`derive`時だけ`concern_propose` Toolの短い`derivationReason`を保存する案がある。一方、schemaを増やさず`why_it_matters`を派生理由として記録する案もあるが、後続のConcern正規化で内容が変わるため監査記録として弱い。

採用: `concern_activities.reason`を追加し、derive時だけ`concern_propose` Toolの短い`derivationReason`を保存する。`why_it_matters`は子Concernが残る理由、`reason`は親Concernから別のConcernをforkした理由として分離する。

## 実装メモ

- `source_concern_id`、`reason`、既存の`event_id` / `evidence_memory_ids`を `derived` Activity の不変監査値として保存した。source Concern と signal Memory ID は Runtime が focus 結果から解決し、モデルへ公開しない。
- Drizzle migration `0051_new_robin_chapel.sql`を生成し、`pnpm db:migrate:test`でテスト DB に適用した。既存 Activity は nullable 新列のまま保持される。
- 検証：`pnpm test`（287 tests）、`pnpm test:system`（67 tests）、`pnpm test:integration`（74 tests）、`pnpm typecheck`、`pnpm lint`、`trace_check.py`。レビュー記録：`docs/work/analyze/2026-11-24-change-080.md`。
