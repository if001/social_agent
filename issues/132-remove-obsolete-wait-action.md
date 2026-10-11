---
created_at: 2026-10-11
status: done
---

# 132: 必須Action契約に残ったwaitを削除する（R01・R02追補）

## Background

[チェックリストR01・R02](../note/refactoring-checklist.md)の最終確認で、必須Action方針に反するwaitがSchemaとプロンプトに残っていた。

## Scope

waitを公開Actionから削除し、Scheduler固有のwait拒否分岐を除去する。通常EventでもSchema修復対象とする。実装設計のInternal / System Eventの旧例も整合する。

## Out of scope

再試行周期、Scheduled Task、BotHost.waitの変更。

## Implementation notes

概念設計 §10・§23、実装設計 §13・§14・§19・§24が根拠。Tool実行後のno-external-actionは維持する。旧wait形式への互換変換は追加しない。

## Acceptance criteria

Schema、prompt、docsが同じAction集合を使い、通常・自律Eventともwaitを受け付けない。

## Tests

通常・自律EventでwaitのSchema修復をcontract検証。全unit/contract、system、evaluation、integration、型検査、lint。

## Result

型検査・lint成功。unit/contract 121件、system 29件、evaluation 6件、DB integration 24件成功。実Ollamaは未実行。DB migration不要。
