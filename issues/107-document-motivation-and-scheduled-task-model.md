---
created_at: 2026-10-10
status: created
---

# 107: 動機・感情・行動とScheduled Taskの設計を文書化する

## Background

現行設計ではDesire、Drive、Current Interestがいずれも動機を表し、Intentionには心理状態、探索継続、外部条件待ち、約束、予約実行が混在している。これにより、Current Interestを失った広いDriveが探索を拡散させ、外部条件待ちのIntentionが自律行動を停止させている。既存モジュールが何によって変化し、何へ影響するかを整理し、DesireとIntentionを削除する設計を一次文書へ反映する。

## Dependencies

- Issue 104
- Issue 105

## Scope

- `spec/`を一次情報として、概念設計と実装設計のDesire / Intentionを見直す
- Self Interest、Preference、Mood、Emotion、Drive、Current Interest、Actionの責務と影響方向を定義する
- DriveとCurrent InterestがActionへ直接影響するフローを定義する
- Current Interestを探索的動機として定義し、focus、当面のgoal、progressの意味を維持する
- 「したくない」を負のDesireとして保存せず、競合する動機、Emotion、Mood、Preference、ConstraintによるAction選択として説明する
- Intentionを心理・動機モデルから削除する
- 将来の明示的な実行を`Scheduled Task`としてRuntime / Tool / Schedulerの責務に分離する
- Scheduled Task Toolの責務をTaskの作成・一覧・取消に限定し、期限到来後の処理はEventとして実行する方針を定義する
- Schedulerがdue Taskをclaimして`scheduled-task` Eventを生成し、通常のAgent Runtimeへ渡すフローを定義する
- 約束の経験はMemory、実行責務はScheduled Taskへ保存する方針を定義する
- `docs/AGENT_MOTIVATION_MODEL.md`、Requirements、Architecture、Implementation Plan、Test Strategyを更新する
- 後続実装Issueの契約、移行順序、削除対象を確定する

## Out of scope

- TypeScript実装の変更
- DB migrationの生成
- Scheduled Task Toolの実装
- Live LLM評価

## Implementation notes

- Self Interestは比較的安定した注意傾向、Current Interestは現在活性化している探索的動機とする。
- Driveは現在継続している広い動機、Current Interestは現在の対象と当面の充足点を表す。
- Emotionは今回Eventへの反応、Moodは複数Eventへ続く感情傾向であり、動機そのものとしない。
- Scheduled Taskは心理状態を複製せず、Toolによって明示的に作成する。
- Scheduled Taskの実行入口はEventだけとする。Toolは将来処理を直接実行・再開せず、SchedulerもAgent Coreを直接呼び出さない。
- `scheduled-task` Eventは通常のEvent処理を通り、Agent Coreが必要なTool利用と最終Actionを判断し、外部応答はOutboxから配送する。
- EventにはTask ID、instruction、destination、source Event / Runを含め、Task・Event・Runを追跡できるようにする。
- 自律行動とScheduled Task実行を別のMermaidフローで図示する。

## Acceptance criteria

- Desireを削除した後のAction選択が説明されている
- Intentionを削除した後も予約処理と約束を失わない設計になっている
- 各状態について、生成・更新元と影響先を確認できる
- Current InterestとDriveの重複範囲と違いが説明されている
- Scheduled Task、Memory、Scheduler、Toolの責務境界が明確である
- Toolによる予約操作とEventによる実行が明確に分離され、実行時の状態遷移と配送経路が説明されている
- 後続Issueが文書だけを根拠に実装できる

## Tests

- Mermaid構文と用語の目視確認
- Requirements、Architecture、Concept Design間の用語検索
- 後続IssueのAcceptance Criteriaとの対応確認
- `pnpm lint`

## References

- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design](../spec/personal-agent-implementation-design-v2.md)
- [Agent Motivation Model](../docs/AGENT_MOTIVATION_MODEL.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
