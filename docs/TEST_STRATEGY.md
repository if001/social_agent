# Test Strategy

## Test layers

### Unit / contract

- Self、State、Concern、Relationship、Memory、Event Assessment、Agent Turnのschema
- Contextの所有権、件数・文字列・推定token budget、Memory重複排除
- State Patchのupsert/removeと別Agent更新拒否
- 不正なstructured output、未登録Tool、call budget、反復Tool入力の拒否
- Concern schedule、Scheduled Task、Reflection契約

### System

- Terminal、Discord、Agent間Messageが同じAgent Loopを通ること
- Event AssessmentからDesire、Action、Patchへの引き渡し
- Tool continuationと最終Action、失敗Toolだけによる無行動拒否
- respond/refuseのOutbox保存と配送再試行
- 自律EventがActionも通知もなく成功しないこと
- crash recovery、複数Agent分離、Runtime制限

### PostgreSQL integration

実migrationと隔離schemaを使い、State version競合、transaction rollback、advisory lock、Memory検索、Reflection commit、Concern schedule、Tool trace、Outbox冪等性を検証する。接続設定はtest processから読み込めるが、値をoutputへ表示しない。

### Evaluation

同一Observationに状態差だけを与えるpaired scenarioを反復し、Action、Tool利用、配送、次Stateをartifactへ保存する。少なくとも以下を含める。

- praise / criticism: MemoryとRelationshipによるMeaning・Feeling・Action差
- boredom: MoodによるAction差
- refusal: 競合Concernによる受諾・拒否差
- curiosity: ConcernとMemoryによる自律Tool利用差
- individuality: 異なる経験から形成されたSelf Storyと行動差

欠測、schema failure、timeout、期待方向に届かない効果量を成功へ含めない。自動testの合格だけで人格らしさを実証済みとはしない。

## Standard verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:system
pnpm test:evaluation
node --env-file=.env ./node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --passWithNoTests
```

DB schema変更時は`pnpm db:generate`でmigrationを生成し、隔離schemaで検証してから、明示的な許可を得て共有DBへ`pnpm db:migrate`を適用する。

## Release conditions

- 全自動suiteが成功する。
- schema、migration、repository、prompt、文書の用語が一致する。
- 旧互換経路をtestのためだけに残していない。
- 振る舞いを主張する場合は反復live evaluation artifactと集計を保存する。
