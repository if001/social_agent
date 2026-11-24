---
created_at: 2026-11-24
status: created
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

- [ ] AC-080-1：derive Activityから親Concernと子Concernを一意に追跡できる。
- [ ] AC-080-2：derive以外のActivityはsource concernを持たない。
- [ ] AC-080-3：migration後も既存ActivityとConcern履歴を失わない。

## Tests

- FR-69, NFR-7：derive commitが親・子・根拠を同一transactionで監査保存する。
- NFR-8：migrationを適用しても既存Concern / Activityが参照可能である。
