---
created_at: 2026-10-04
status: created
---

# 039: Intention Triggerと自律Internal Eventを実装する

## Background

specはIntention Triggerとしてtime、event、idle、manual-reviewを定義し、persistent-drive、memory-recall、self-continuity、state-review等のInternal EventをRuntimeが既存Stateから発火するとしている。現在のSchedulerは`next_review_at`のIntentionとLong-term Candidateだけをclaimし、trigger JSON、idle、persistent-driveを評価しない。

## Scope

- specのIntention lifecycle、Internal Event、Autonomous Actionをdocsと照合し、trigger semanticsを先に確定する。
- time、event、idle、manual-review triggerの保存・評価・claim・再scheduleを実装する。
- persistent Driveと必要なstate reviewからInternal Eventを生成する。
- 同一対象のlease、再起動回収、backoff、自己起動loop防止を実装する。
- 外部通知はAgent Actionが必要と判断した場合だけ行う。

## Out of scope

- cron互換の高度なschedule式。
- 固定確率による自律行動。
- Long-term Review固有triggerの改善。

## Implementation notes

- Runtimeが再検討機会だけを作り、行動内容はCoreが決める原則を守る。
- idleはprocessの無活動だけでなく、Agent単位の最終Event時刻を基準にする。
- event triggerは無制限な全文LLM判定ではなく、機械的候補抽出とCore判断を分離する。

## Acceptance criteria

- [ ] 4種類のIntention Triggerが保存・復元・評価される。
- [ ] persistent-drive等のInternal Eventが既存Stateから生成される。
- [ ] 停止中にdueとなった対象が再起動後に1回だけ処理される。
- [ ] Internal Eventの無限自己起動を防止できる。

## Tests

- Fake Clockによるtime／idle／manual trigger unit test。
- 関連Eventと非関連Eventのtrigger test。
- DB lease、crash recovery、重複抑止のintegration test。
- 自律Eventからwait／no-action／respond／Tool利用へ到達するsystem test。

## Dependencies

- 038

## Plan reference

- [Implementation Design §13–14, §24–25](../spec/personal-agent-implementation-design-v2.md)
- [Implementation Plan: Scheduler and autonomy](../docs/IMPLEMENTATION_PLAN.md)
