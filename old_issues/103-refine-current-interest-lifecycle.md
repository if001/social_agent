---
created_at: 2026-10-09
status: done
---

# 103: Current Interestの意味と収束・再形成フローを修正する

## Background

Current Interestが具体的なKnowledge Gapの`question`に限定され、主要な理解を得た後も75%のまま残り、追加調査の価値が低いことを理由に`no-action`が反復している。一次設計のInterestは興味を持つ対象であり、Current Interestは現在注意が向く対象と当面の満足点として扱う必要がある。Self Interest、Preference、Desire、Intentionとの責務も明確にする。

## Dependencies

- Issue 082
- Issue 103はIssue 102完了後のmainを起点とする

## Scope

- `CurrentInterest.question`を`focus`へ変更する
- `goal`を最終目的ではなく、現在の知識・経験に応じた当面の満足点として定義する
- Self Interest、Preference、Drive、Current Interest、Desire、Intentionの違いをdocsへ反映する
- 追加行動の価値が低く現在のgoalを十分満たしたInterestを`resolve`し、必要な将来行動だけIntentionへ分離する判断をPost-processへ追加する
- 行動可能なCurrent Interestが存在しない、すべてcooldown中、または既存Interestが収束した場合、件数を機械的に補充せず、会話、Social Context、Memory、Tool結果、Web Snapshot、Drive、Intention結果、Self Interestから新しいfocusを検討する
- 既存Current Interestに関係する経験は新規作成より`progress | reframe | resolve | drop`を優先する
- Schema、検索・Context構築、Debug UI、評価fixture、テストを更新する
- 既存JSONB状態の`question`を`focus`へ変換するDrizzle migrationを追加する

## Out of scope

- Current Interestの固定件数または最低件数
- Momentary Curiosityという新しい永続状態
- Current InterestとIntentionの統合
- Stable InterestのLong-term Review更新実装

## Implementation notes

- Current Interestは現在注意が向く対象、`goal`は当面の満足点、`progress`はその目安への粗い進捗である。
- DesireはEvent内の「したい／したくない」、Intentionは後続Eventまで維持する具体的行動方針とする。
- resolve/drop後も経験はMemoryとState Changeへ残り、Self InterestやDriveから別のCurrent Interestが後に形成され得る。
- 「少ない」は数値ではなく、存在しない、すべてcooldown中、収束可能、停滞中など、現在行動可能なfocusが不足した状態を指す。

## Acceptance criteria

- Current Interestが`focus`、`goal`、`progress`で表現される
- goalを十分満たした判断が、ユーザーへの発信機会がないことを理由に延期されず`resolve`できる
- 説明や共有などの将来行動はCurrent InterestではなくIntentionとして継続できる
- 行動可能なCurrent Interestが不足した場合に、Self Interest以外を含む経験源から新しいfocusを検討できる
- Current Interestを件数だけで作らない
- 既存DBのCurrent InterestをDrizzle migration後も読み取れる

## Tests

- Current Interest Schemaとproposalの`focus`契約test
- create / progress / reframe / resolve / drop test
- Context選択とMemory queryのfocus利用test
- Interaction / Continuity prompt方針test
- migration test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`
- DB integration test

## References

- [Concept Design: Self Interests](../spec/personal-agent-concept-design-restructured-v2.md#7-self)
- [Concept Design: Desire / Intention](../spec/personal-agent-concept-design-restructured-v2.md#10-desire--intention)
- [Requirements: Agent State](../docs/REQUIREMENTS.md)
- [Architecture: Current Interest](../docs/ARCHITECTURE.md)
