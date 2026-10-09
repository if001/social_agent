---
created_at: 2026-10-10
status: done
---

# 105: Driveを自律行動へ接続する

## Background

Active Driveが存在しても、外部の対話機会を必要とするIntentionを理由に自律Eventが`wait`または実質的な無行動で終了している。Driveは現在継続している動機であり、Schedulerが作った行動機会では現在可能な小さな行動へつなげる必要がある。また、従来の`no-action`はTool利用後に外部配送を行わない場合にも使われ、実際の意味と名称が一致していない。

## Dependencies

- Issue 103
- Issue 104

## Scope

- `no-action`を`no-external-action`へ改名する
- 自律Eventでは`wait`を選ばない
- 外部条件待ちのIntentionを自律Event全体の停止理由にしない
- Active Driveがある自律Eventでは、Tool利用、質問、応答、またはDrive解消につながる観測可能な行動を要求する
- Tool利用後に外部へ通知しない結果は`no-external-action`で表す
- docs、Runtime、Scheduler、fixture、評価、テストを更新する

## Out of scope

- Schedulerの実行間隔変更
- Driveから特定Toolへの固定対応表
- 通常のユーザーEventにおける`wait`の廃止

## Implementation notes

- 自律Eventは`payload.schedulerGenerated=true`で識別する。
- Active Driveがある自律Eventで、Tool実行なしの`no-external-action`を返した場合は構造化出力をrepair対象とする。
- Driveの内容から行動内容を固定規則で決めず、CoreがSelf、状態、経験、利用可能Toolから小さなActionを選ぶ。

## Acceptance criteria

- Driveがある自律Eventが、外部条件待ちだけを理由に停止しない
- 自律Eventの`wait`が拒否される
- Toolで内部探索した後は外部配送なしで正常終了できる
- `no-external-action`が最終的な外部配送なしを表す

## Tests

- FinalAction契約test
- 自律Eventのwait拒否test
- Active Drive + Toolなし + no-external-action拒否test
- Active Drive + Toolあり + no-external-action許可test
- Scheduler、system、integration test
- `pnpm typecheck`
- `pnpm lint`

## References

- [Agent Motivation Model](../docs/AGENT_MOTIVATION_MODEL.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
