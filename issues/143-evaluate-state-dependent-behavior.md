---
created_at: 2026-10-11
status: done
---

# 143: 状態差による行動差を反復評価する

## Background

[敵対レビューの致命的指摘5・8とP2](../note/adversarial-review-2026-10-11.md)では、fake invokerが自らToolを呼ぶテストは配線しか証明せず、現行rubricも怒り、喜び、拒否、退屈、自発探索などの状態依存差を測らないと指摘されている。[概念設計 §13・§23](../spec/personal-agent-concept-design-restructured-v2.md)が求めるのは、経験と状態の違いから同じ出来事への行動が変わり、個体差として知覚できることである。

## Scope

- 実モデルまたは固定応答ではない小型評価モデルで対照試験を実行する。
- 同一Observationに対し、称賛経験、信頼関係、退屈Mood、強いMotive、due Motive、Agentの経験だけを変えるpaired scenarioを作る。
- 喜び・誇り、怒り・悲しみ・受容、脱線・改善提案、拒否・交渉・後回し、自発Tool/共有を複数回測定する。
- Action本文だけでなく、chosen Motive、Tool選択、Outbox配送、次回Emotion/Mood/Motiveへの影響を評価する。
- 質問、共有、拒否、感情表明、脱線を評価artifact上で分類できる観測形式を設ける。

## Out of scope

- 合格率を上げるための固定Behavior prompt追加。
- 1回の成功例をrelease gateとすること。
- provider/model間の網羅的benchmark。

## Implementation notes

- fake invokerによるunit/system testは配線検証として残してよいが、自律性の合格証拠に数えない。
- seed、model、temperature、入力、出力、配送結果、state deltaをartifactへ保存する。
- 行動分類は観測・評価用とし、Coreへ固定選択肢を強制しない。
- 修正時はレビューのP2一覧と一次資料を参照し、Schema valid率だけを成功条件にしない。

## Acceptance criteria

- 各paired scenarioを複数回実行し、状態あり/なしの行動分布差を報告できる。
- due Motiveケースでユーザー入力なしのToolまたは共有選択を観測できる。
- 同一Agentの経験前後の変化と、別Agentとの差を区別して記録できる。
- 配線失敗、Schema失敗、意味評価失敗、配送失敗を別々に集計する。
- release判定が行動差、Tool選択、配送、次回stateへの影響を含む。

## Tests

- evaluatorとartifact schemaのunit/contract test。
- paired scenario runnerのdeterministic plumbing test。
- 許可されたlive modelによる反復evaluation。
- 集計の再現性確認、typecheck、lint。

## Dependencies

- 134
- 137
- 140
- 141
- 142

## Source plan

- [敵対レビュー: P2](../note/adversarial-review-2026-10-11.md#p2-振る舞いを検証する)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
