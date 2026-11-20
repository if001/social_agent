---
created_at: 2026-11-20
status: created
type: change
plan: []
requirements: [FR-77, FR-82, NFR-9, NFR-10]
ui: []
requires: agent
---

# 057 canonical peer subject aliasを明示的に移行する

元計画：[#052](052-design-canonical-subject-registry-for-multi-bot.md)のsubject alias変更・統合規則

## Background

peer設定の表示名・Discord ID・Agent IDが変更されても、同じ対象を表すsubjectを安全に統合できなければ、Agent固有のMemory / Relationshipが断片化する。誤った一括更新を避けるため、移行は明示CLIでdry-runを既定とする。専用の監査tableは設けない。

## Dependencies

- 055

## Scope

- `--agent-id`、`--from-subject`、`--to-subject`を必須とするmigration CLIを追加する。
- dry-run既定で対象件数と重複解消予定を表示し、`--apply`だけが書込みを行う。
- 指定Agent所有の`memory_subjects`、`event_subjects`、`agent_states.relationships`だけを新subjectへ統合する。
- `to-subject`は`user-main`又は当該Agentの現在のpeer allowlistにある`agent:<agentId>`だけを受理する。形式不正、self、owner外、allowlist外はdry-run / applyとも拒否する。
- 同一対象への重複linkは一意にする。from / to双方にRelationshipがある場合、すでにcanonicalなto側のdescriptionを残し、from側だけならsubjectを書換える。Relationship entryに更新時刻はないため、本文の新旧を推測して統合しない。
- applyはAgent stateのversionを読み、同一transactionでversion条件付き更新を行う。競合時は全変更をrollbackして失敗し、再読込後に利用者が再実行する。

## Out of scope

- alias履歴や専用監査recordの保存
- 全Agent横断のsubject更新
- 設定変更を検出した自動migration

## Acceptance criteria

- [ ] AC-057-1：dry-runはDBを書き換えず、Agent所有範囲の更新・重複解消件数を表示する。
- [ ] AC-057-2：`--apply`は指定AgentのMemory subject、Event subject、Relationshipだけを統合する。
- [ ] AC-057-3：異なるAgentのsubject / Relationshipは変更しない。
- [ ] AC-057-4：再実行しても重複linkやRelationshipを増やさない。
- [ ] AC-057-5：allowlist外又はselfを`to-subject`に指定したmigrationはdry-run / applyとも拒否する。
- [ ] AC-057-6：Relationshipの競合時はto側descriptionを残し、Agent state version競合時は部分更新しない。

## Tests

- FR-77, FR-82：dry-run / apply、Agent所有境界、重複解消、再実行の冪等性をrepository integration testで検証する。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `scripts/` | subject alias migration CLI | 追加する |
| `src/infrastructure/repositories/` | subject link / Relationship統合 | 更新する |
| `tests/` | dry-run / apply / ownership | 更新する |
