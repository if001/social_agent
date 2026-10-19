---
created_at: 2026-10-11
status: done
---

# 123: 自律応答もRuntimeのOutboxから配送する（R06）

## Background

[チェックリストR06](../note/refactoring-checklist.md)。通常応答とScheduled TaskはOutboxを使うが、自律応答はSchedulerが直接publishしていた。

## Scope

Schedulerは宛先とreplyContextをEventへ設定する。Runtimeが共通Envelope生成とcommitを行い、OutboxDispatcherが配送する。Schedulerのqueue依存を削除する。

## Out of scope

Event優先度、外部サービスのexactly-once保証。

## Implementation notes

実装設計 §3・§14・§27・§29が根拠。宛先なしでは配送しない。Scheduled Taskの明示宛先を維持する。外部配送は同じOutbox IDで再試行し、下流の重複排除契約を使う。

## Acceptance criteria

- Schedulerに外部応答の直接publishがない
- replyContext、correlation、causation、TTLとhopを保持する
- 配送失敗してもcommit済みの応答がOutboxに残る

## Tests

Scheduler unit、Runtime systemの配送失敗→再試行→送信済み除外、typecheck、lint。

## Result

型検査・lint成功。unit/contract 114件、system 26件成功。migration不要。
