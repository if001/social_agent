---
created_at: 2026-10-11
status: done
---

# 129: 中断可能な待機処理を共通化する（R12）

## Background

[チェックリストR12](../note/refactoring-checklist.md)。BotHostとPost-processの手書きdelayは通常終了後にabort listenerを解除していなかった。

## Scope

Node標準のtimers/promisesを使う共通待機helperを作り、Queue pollingを含む3経路で利用する。

## Out of scope

処理周期、retry回数、停止ポリシー変更。

## Implementation notes

実装設計 §29・§30に従う。abort時は待機を正常終了し、呼び出し元loopのsignal判定に戻る。

## Acceptance criteria

事前abort、待機中abort、通常終了でlistener/timerが残らない。

## Tests

listener数のunit、Queue contract、shutdownと後処理system、typecheck、対象lint。

## Result

型検査成功、unit/contract 119件、system 29件成功。lint指摘を修正後、対象lintと待機unit 2件を再確認して成功。
