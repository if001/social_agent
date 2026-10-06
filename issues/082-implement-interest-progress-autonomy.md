---
created_at: 2026-10-06
status: done
---

# 082: Interest進捗に基づく自律探索と減衰を実装する

## Background

Issue 081で、初期SelfのStable Interestから、Autonomy Review Internal Event、Knowledge Gap、一時的Desire、探索Action、Memory、Current Interest、必要なDrive / Intentionへ進む因果経路をdocsへ定義する。

現行のCurrent Interestは文字列配列で、Question、Goal、Progressを保持できない。Autonomy Review promptもDrive、Current Interest、Memoryを中心にしており、Drive、Current Interest、Intentionが空の場合にStable Interestから最初の探索を開始しにくい。Continuity Updateは汎用State UpdateとしてCurrent Interestを扱うため、進捗、解消、再定義、停滞を明示的に検証できない。

Issue 081の確定仕様に従い、Current Interestの最小構造、専用Proposal、Runtime管理の停滞・cooldown、自律探索prompt、保存と回帰検証を実装する。

## Dependencies

- Issue 081

## Scope

- Issue 081完了後、確定したdocsと本IssueのScope、契約、完了条件を再確認する
- `CurrentInterest`を次の最小構造へ変更する
  - Runtime-owned ID
  - question
  - goal
  - progress: `0 | 25 | 50 | 75 | 100`
- 旧`string[]`のCurrent Interest契約と不要な互換処理を削除する
- Current Interest専用Proposal Schemaを実装する
  - create
  - progress
  - reframe
  - resolve
  - drop
- LLMにID、所有Agent、時刻、停滞回数を生成させず、Runtimeが付与・検証する
- progress、resolve、reframe、dropのreasonとevidence IDをState Changeから追跡可能にする
- Current Interestの詳細な学習内容を重複保存せず、Memory / Web Snapshotへ保存する
- Runtime管理の探索metadataを実装する
  - consecutive no-progress count
  - last explored time
  - cooldown until
- metadataをLLM出力Schemaから除外し、Agent Core入力では判断に必要な範囲だけ提示する
- progress増加時にno-progress countをresetする
- progressが増えない探索ではno-progress countを増やす
- 停滞時に別手段、wait、cooldown、dropを選択可能にし、機械的上限を越える即時再探索を拒否する
- goal達成時にCurrent Interestをresolveし、関連するDrive終了、Intention完了を提案可能にする
- Autonomy Review promptを日本語で修正する
  - Drive、Current Interest、Intentionが空でもStable InterestとPreferenceを参照する
  - Autonomy Review Eventを探索機会というInternal Observationとして意味づける
  - 今回扱うInterestを最大1件選ぶ
  - Knowledge Gapと一時的Desireを形成する
  - 必要ならWeb Toolを使う
  - 外部通知の価値がなければ内部保存だけにする
- Continuity Update promptと出力契約を修正する
  - Tool ResultとInteractionを根拠にCurrent Interestの進捗を評価する
  - 初回探索結果から必要な場合だけDriveまたはIntentionを生成する
  - SelfやPersona単体から永続Driveを固定生成しない
- Memory Extractionが探索内容、確認事項、Web Snapshot IDを保存する既存経路を維持する
- Context Loader、Memory Query、Autonomy Review入力を構造化Current Interestへ対応させる
- `agent_states.current_interests`と必要な探索metadataのDrizzle Schema・migrationを更新する
- 既存の動作確認データに対する後方互換やdata migrationは実装せず、新契約へ統一する
- Debug UIでquestion、goal、progress、停滞・cooldownを確認できるようにする
- `config/initial-self`はStable Interestsを保持し、Current InterestsとDriveは原則空のまま開始する

## Out of scope

- 厳密な予測誤差、確率、precision、Free Energyの計算
- Reward Modelまたは数値Personality weight
- Personaを探索の根拠にすること
- Stable Interestsを毎回すべて探索すること
- Current Interestごとの常設Scheduler
- Web検索Provider自体の変更
- 長期間の人格品質を自動合否判定すること

## Implementation notes

- 初回探索では永続Driveを先に要求せず、一時的DesireとTool Actionを許可する。
- progressは知識の客観的割合ではなく、Goalに対する粗い自己評価である。Promptに各段階の基準と完全な出力例を記載する。
- progressが増えないことと、Question / Goalが新しい情報で変化したことを区別する。後者は`reframe`として停滞扱いにしない。
- 新しい疑問が元のGoalと十分異なる場合は、元Interestをresolveし、新しいInterestをcreateする。
- Self、Disposition、Preference、Mood、Driveは粘り方や探索方法の意味判断へ使う。Runtime上限は性格にかかわらず越えられない。
- 短い検証間隔でも同じ検索とDiscord通知を繰り返さないことを優先する。
- LLMへCurrent Interest全体を毎回再生成させず、用途別Proposalを構造化出力させる。

## Acceptance criteria

- Drive、Current Interest、Intentionが空でも、Stable Interestから有界な自律探索を開始できる
- 初回探索に永続Driveの事前生成を要求しない
- Current Interestが`id`、`question`、`goal`、段階的`progress`を持つ
- LLMがCurrent Interest ID、時刻、停滞回数を生成しない
- Tool Resultによりprogressを更新できる
- Goal達成時にInterestをresolveできる
- 進展しない探索がcooldownまたはdropへ移り、同じ検索を無限に繰り返さない
- SelfやDispositionだけから同じDriveを毎Reviewで再生成しない
- 新しい疑問へのreframeと単純なno-progressを区別できる
- 探索内容がMemoryとWeb Snapshotへ保存され、Current Interestへ本文を重複保存しない
- 外部へ伝える価値がある場合だけDiscordへ自律投稿する
- Debug UIでCurrent Interestの進捗と探索抑制状態を確認できる
- 旧文字列Current Interest契約が残っていない

## Tests

- Current Interest SchemaとProposalのcontract test
- create、progress、reframe、resolve、dropのState Update unit test
- progress増加時の停滞reset test
- no-progress反復時のcooldown test
- Drive / Current Interest / Intentionが空でStable InterestだけあるAutonomy Review test
- Stable InterestからWeb Toolを最大1テーマで利用するsystem test
- Tool ResultからMemoryとCurrent Interest進捗へ接続するsystem test
- Goal達成時にCurrent Interest、Drive、Intentionが収束するtest
- 同一Interest・同一検索の反復抑制test
- 外部通知あり・内部保存のみの分岐test
- PostgreSQL round-trip integration test
- Debug UI表示test
- 1 scenario × 1回のOllama live smoke
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`
- `pnpm test:evaluation`

## References

- [Issue 081](./081-align-docs-for-interest-progress-autonomy.md)
- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design](../spec/personal-agent-implementation-design-v2.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Implementation Plan](../docs/IMPLEMENTATION_PLAN.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
- [Issue 076: Selfと価値判断に基づくDrive形成](./076-ground-drive-formation-in-self-and-value.md)
- [Issue 077: Self・Drive・Interestによる自律判断](./077-ground-autonomous-decisions-in-self-drive-and-interest.md)
