---
created_at: 2026-10-11
status: done
---

# 137: Deep Agents middlewareを明示的な最大2段loopへ置き換える

## Background

[敵対レビューの致命的指摘4と不要コンポーネント1〜3](../note/adversarial-review-2026-10-11.md)では、使われていないSubAgent、二重化したFilesystem Tool、初回から発火し得るsummarizationが故障点を増やし、小さなloopの利点を失わせていると指摘されている。[概念設計 §23](../spec/personal-agent-concept-design-restructured-v2.md)と[実装設計 §2・§3](../spec/personal-agent-implementation-design-v2.md)の単純なAgent Coreへ戻す。

## Scope

- 通常は1 model decisionで最終Actionを確定する。
- Toolが必要な場合だけ、Toolを1回実行して1回のcontinuationで最終Actionを確定する。
- SubAgent、built-in Filesystem、summarization middlewareをCore経路から除去する。
- 独自Tool Registryの権限、実行記録、結果projectionを唯一のTool経路にする。
- `feltMeaning`、Emotion、chosen Motive、Actionを一つの小さなdecision契約として定義する。

## Out of scope

- Tool実装自体やTool権限モデルの変更。
- 複数Toolを必要とする将来用途の一般化。
- Post-processの統合。

## Implementation notes

- 安全基盤である所有権、permission、idempotency、deadline、transaction、Outboxを維持する。
- Tool結果後のcontinuationは新規探索を開始せず、結果を解釈して最終Actionとstate deltaを作る。
- 1 Toolでは成立しない既存ユースケースを棚卸しし、暗黙に複数回実行しない。
- 修正時はレビューの「推奨する最小構成」と一次資料を読み直し、framework機能の再導入を目的にしない。

## Acceptance criteria

- Toolなしrunはmodel call 1回、Toolありrunは最大2回で完了する。
- Core経路にSubAgent、built-in `read_file`、summarization middlewareが残らない。
- Toolは登録済みTool Registryだけを通り、権限と履歴を維持する。
- final Actionがないrunは成功扱いにならない。

## Tests

- Toolなし、Toolあり、Tool失敗、期限切れのsystem test。
- 未登録Toolと2回目Tool要求のcontract test。
- 既存Web/File/Scheduled Taskの代表的なintegration test。
- typecheck、lint、関連evaluation。

## Dependencies

- 135
- 136

## Source plan

- [敵対レビュー: P0-4](../note/adversarial-review-2026-10-11.md#p0-症状を直接止める)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
