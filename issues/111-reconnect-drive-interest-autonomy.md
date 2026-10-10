---
created_at: 2026-10-10
status: done
---

# 111: DriveとCurrent InterestをMotiveへ統合する

## Background

DriveとCurrent InterestはともにActionを直接生じさせる持続的な動機であり、広さや探索性の違いだけで別状態になっていた。この分離により、DriveがあってもCurrent Interestがないため行動対象がないと判断する不整合が生じている。すべてのActionを、そのEventで活性化した動機から選ぶ単一モデルへ変更する。

## Dependencies

- Issue 107
- Issue 108
- Issue 109
- Issue 110

## Scope

- DriveとCurrent Interestを単一の`Motive`契約・DB状態・提案へ統合する
- Motiveは`id`、`description`、任意の`goal / progress`、根拠、開始時刻を持つ
- 探索以外の動機へgoal / progressを強制しない
- 外部Eventと自律Eventの双方で、保存済みMotiveまたは今回のEventから活性化したMotiveに基づきActionを選ぶ
- Interaction出力へ、今回Actionの根拠となったEvent内の`activeMotive`を必須で1件追加する。これは永続状態にしない
- Interaction Agentが処理するすべてのEventでMotiveを必ず1件活性化し、そのMotiveに基づくActionを必ず実行する
- 保存済みMotiveがない場合は、今回のEvent、Self、Mood、Memory、Social Contextから今回限りのMotiveを形成する
- Tool利用、応答、質問、共有、拒否などの具体的実行を伴わず、理由だけを返す`no-external-action`を禁止する。Tool実行後に外部配送しない最終結果は許可する
- Post-processはMotiveをcreate / maintain / update / merge / resolve / dropする
- 自律ScheduleをMotive単位に統合し、旧Drive・Current Interest用の状態と処理を削除する
- Recent Experience、Memory検索、Debug UI、評価scenario、初期Self、docsを更新する
- Timeout / Provider failureの試行をOutcomeとして保存し、反復とRun stormを抑止する

## Out of scope

- Planner、Desire、Intentionの追加
- 動機生成専用Eventの追加
- Scheduled Taskの心理状態化

## Acceptance criteria

- 永続的なDrive / Current Interest契約がなく、Motiveへ統合されている
- 全Actionに今回のactiveMotiveがあり、既存Motive IDまたはEvent内根拠へ結び付く
- Interaction Agentが処理した全RunでactiveMotiveがちょうど1件選ばれ、対応する具体的Actionが実行される
- Motiveがない場合もEvent、Self、Mood、Memory、Social Contextから今回の動機を形成して行動できる
- 次のEventにも残る動機だけPost-processでMotiveとして保存する
- goal / progressを持つ探索Motiveと、持たない非探索Motiveの両方を扱える
- 同一Motiveを複数Scheduleが重複起動しない
- 失敗試行を同じ形で反復せず、通常周期またはbackoffへ戻る

## Tests

- Motive contract / lifecycle test
- Event-derived activeMotive → Action test
- activeMotiveの必須性と、理由だけのno-external-action拒否test
- exploratory / non-exploratory Motive test
- Schedule重複防止test
- Timeout / failure outcome test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`
- DB integration test

## References

- [Agent Motivation Model](../docs/AGENT_MOTIVATION_MODEL.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
