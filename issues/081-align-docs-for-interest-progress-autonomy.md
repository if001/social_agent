---
created_at: 2026-10-06
status: done
---

# 081: Interest進捗と自律探索の形成・減衰をdocsへ反映する

## Background

概念設計は、ユーザー入力がなくてもSelf、Disposition、Drive、Memory、Internal Event等から自律行動できることを想定している。一方、具体例は未解決Memory、Drive、Intentionがすでに存在する場合を中心としており、初期Selfの安定したInterestsしかない状態から最初の探索を開始する因果経路が明確でない。

現在の実装とdocsでは、Autonomy ReviewがDrive、Current Interest、Intention、Memoryを強い行動根拠として扱い、Continuity UpdateはSelfやDispositionだけからDriveを生成しない。このため、初期InterestsとPreferencesを設定しても、Drive、Current Interest、Intentionがすべて空なら`no-action`を繰り返しやすい。

安定したInterestを固定的にDriveへ変換せず、Autonomy ReviewというInternal Observation、時間経過、最近の探索履歴、Knowledge Gapと組み合わせて一時的なDesireと探索Actionを生じさせる。探索後の進捗によってCurrent Interestを継続・解消し、進展しなければ探索意欲を減衰させる設計をdocsへ確定する。

## Scope

- `spec/`を一次情報として、以下の既存概念との整合を確認する
  - Self、Disposition、Interests、Preferences
  - Drive、Desire、Intention
  - Subjective Meaning
  - Internal Event、Time Event、Autonomous Action
  - Tool Resultを新しい経験として扱う境界
- 初期Interestから最初の自律探索を開始する因果経路を定義する
  - Stable Interest / Preference
  - Autonomy Review Internal Event
  - 時間経過と最近の探索履歴
  - Knowledge Gapの形成
  - 一時的Desire
  - Tool利用またはユーザーへの自発的な問いかけ
- 「SelfやDispositionだけからDriveを固定生成しない」という制約を維持しつつ、外部入力を必須としないことを明記する
- Current Interestを次の最小契約として定義する
  - Runtimeが付与する`id`
  - 何を知りたいかを表す`question`
  - どの状態なら一旦満たされたとするかを表す`goal`
  - 目標への自己評価を表す`progress`
- `progress`はLLM出力安定性を優先して`0 | 25 | 50 | 75 | 100`の段階値とする
- 学習内容の詳細はCurrent Interestへ重複保存せず、Episodic / Semantic MemoryとWeb Snapshotへ保存する
- Current Interestの操作契約を定義する
  - create
  - progress
  - reframe
  - resolve
  - drop
- Driveとの関係を定義する
  - 初回探索に永続Driveを必須としない
  - InterestとInternal Eventから一時的DesireとActionを生成できる
  - 探索結果が継続的な価値を持つ場合だけDriveを生成する
  - goalを満たした場合は関連Driveを終了し、Intentionを完了できる
- 探索進展と減衰を定義する
  - progress増加は情報収集欲求が部分的に満たされた状態
  - goal達成はCurrent Interestのresolve
  - 進展なしはRuntime管理の連続停滞回数へ反映
  - 停滞時は別手段、延期、cooldown、dropを選択可能
- Runtime管理情報をLLM出力契約から分離する
  - consecutive no-progress count
  - last explored time
  - cooldown until
  - Tool call、run、rate上限
- 探索をどこまで続けるかはSelf、Disposition、Preference、Mood、Driveと現在の進捗をAgent Coreが意味判断し、Runtimeが機械的上限を強制する責務分担を定義する
- 同じInterestの反復検索、無限探索、10分ごとの外部通知を避ける条件を定義する
- 自律探索結果を外部通知する条件と、内部保存だけで終える条件を定義する
- `docs/ARCHITECTURE.md`、`docs/REQUIREMENTS.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/TEST_STRATEGY.md`、必要に応じて`docs/MANUAL_SMOKE.md`を更新する
- docs確定後にIssue 082の実装ScopeとAcceptance Criteriaを再確認し、必要なら修正する

## Out of scope

- Current Interest契約、DB Schema、prompt、Runtimeの実装変更
- 数値的な予測誤差、確率分布、Active Inference、Free Energyの厳密な計算
- Reward Modelや固定のPersonality weight table
- Current Interestごとの無制限なSchedule生成
- 長期間運用後の人格品質評価
- Personaを探索動機の根拠にすること

## Implementation notes

- `question`は現在認識しているKnowledge Gap、`goal`は一旦の充足条件、`progress`はその差がどこまで縮んだかの粗い自己評価として扱う。
- `progress`は知識量の客観的割合ではなく、行動継続判断に使う段階値である。詳細な理由と根拠はProposal、State Change、Memoryへ保持する。
- 新しい疑問が十分異なる場合は、一つのInterestを肥大化させず、元のInterestをresolveして新しいInterestをcreateする。
- 進捗が減る場合を単純な失敗とみなさない。新しい情報によってQuestionやGoalが変わる場合は`reframe`として扱う。
- Autonomy Review Eventそのものを「関心へ注意を向ける機会」というInternal Observationとして扱い、Selfだけからの固定変換を避ける。
- Character設定としてのInterestsと、経験中のCurrent Interestを混同しない。

## Acceptance criteria

- 初期Interestsしかない状態から最初の自律探索が始まる因果経路がdocsに明記される
- SelfまたはDisposition単体から永続Driveを固定生成しない原則が維持される
- 外部ユーザー入力が自律探索の必須条件ではないことが明記される
- Current Interestが`id`、`question`、`goal`、`progress`の最小構造として定義される
- `progress`が`0 | 25 | 50 | 75 | 100`へ限定される
- Knowledgeの詳細保存先がMemoryとWeb Archiveであることが明記される
- create、progress、reframe、resolve、dropの意味と生成条件が定義される
- 進展、充足、停滞、cooldown、放棄の遷移が定義される
- Agent Coreの意味判断とRuntimeの回数・時刻・上限制御が分離される
- 探索結果をDiscordへ投稿する場合と内部保存だけにする場合が区別される
- Issue 082が確定したdocsと矛盾しない

## Tests

- `docs/`間でCurrent Interestの型、操作、責務、用語が一致することをレビューする
- 初期Interestから探索開始までのsequenceまたはflowをdocsで確認する
- progress増加、goal達成、停滞、reframe、dropの例を確認する
- 外部入力なし、Driveなし、Intentionなしのケースが仕様上扱えることを確認する
- 同一Interestの反復探索を防ぐ制約がTest Strategyへ記載されていることを確認する

## References

- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design](../spec/personal-agent-implementation-design-v2.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Implementation Plan](../docs/IMPLEMENTATION_PLAN.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
- [Issue 076: Selfと価値判断に基づくDrive形成](./076-ground-drive-formation-in-self-and-value.md)
- [Issue 077: Self・Drive・Interestによる自律判断](./077-ground-autonomous-decisions-in-self-drive-and-interest.md)
