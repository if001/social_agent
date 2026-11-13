---
created_at: 2026-11-14
status: done
type: fix
plan: []
requirements: [追加]
requires: agent
---

# 035 Memory根拠Event上限超過の正規化

元の会話：Reflection中に、既存Memoryの`evidenceEventIds`が22件となり、最大16件の契約検証で失敗した。

## Background

Memory Formationは16 Event batch内で根拠を解決するが、`MemoryWriteService`のupdate / reconciliationは既存根拠と新規根拠を無制限に和集合化している。そのため既存MemoryをReflectionのrefreshで読めなくなり、Reflection Session全体が失敗する。

## Dependencies

- #034

## Scope

- 16件を超える既存`memories.evidence_event_ids`を空配列へ正規化する、dry-run対応のデータ移行scriptを追加する。
- Memory更新とreconciliationで根拠Eventを最大16件に保つ。
- 既存Memory本文、種別、embedding、`memory_mutations`の履歴は変更しない。

## Out of scope

- 根拠Eventを意味的に再選別すること。
- Event全体またはReflection Session Event数の制限。

## Implementation notes

- 空の根拠は誤って蓄積したリンクを解消するための暫定状態であり、後続Reflectionが新しい根拠を設定できる。
- 保存時の上限処理は決定論的に新しい根拠を優先し、重複除去後の先頭16件を残す。

## Acceptance criteria

- [x] 16件超の既存Memoryだけが、明示的な`--apply`時に空の根拠配列へ更新される。
- [x] dry-runはDBを書き換えない。
- [x] update / reconciliation後も、保存される根拠Eventは16件以下である。
- [x] 根拠が16件超だったMemoryを含んでもReflectionのrefreshがschema検証で失敗しない。

## Tests

- 追加：dry-run / applyのデータ移行script。
- 追加：Memory update / reconciliationの根拠上限。
- 追加：上限超の既存Memoryを正規化後にReflection refreshできること。

## 実装メモ

- `pnpm memory:evidence:normalize [--agent-id <id>] [--apply]` を追加した。既定はdry-runであり、適用時だけ16件超の`evidence_event_ids`を空配列にする。本文、種別、embedding、履歴、更新時刻は変更しない。
- `MemoryWriteService`はupdate / reconciliation時に新しい根拠を優先して重複除去し、先頭16件だけを保存する。
- 本番の`shiro`に対してdry-runで1件を確認し、`--apply`で1件を正規化した。再dry-runは0件だった。
- 検証: unit 9 passed、integration 51 passed、変更Production / unit testファイルのeslint、`tsc --noEmit`、`git diff --check` passed。
- レビュー: `docs/work/reviews/2026-11-14-issue-035.md`。上流ドキュメントの変更は不要（既存の16件上限契約を永続化経路へ揃える修正）。
