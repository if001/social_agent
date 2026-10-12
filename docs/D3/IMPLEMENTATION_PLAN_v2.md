# Agent Architecture Redesign Implementation Plan

作成日: 2026-10-11
対象方針: [自律パーソナルエージェント再設計方針](../note/agent-architecture-redesign-policy.md)
失敗基準: [Issue 148 live evaluation](../issues/148-run-paired-live-evaluation-and-gate.md)

## 1. 目的と完了条件

現行の多段後処理・永続化経路を、Event AssessmentとAgent Coreの責務を分離したEvent駆動のAgent Loopへ置き換える。Event AssessmentはMeaning / Emotionを決定し、Agent Coreはその結果を受けてDesire / Actionを決定する。

作業は専用branchで行い、次の条件をすべて満たしてからmainへmergeする。

- 通常Eventと自律Eventが同じAgent Loopを通る。
- Event Assessmentが決定したMeaning / Emotionは、同一run内でAgent CoreのAction判断へ必ず渡る。
- Actionの決定権はAgent Coreだけが持つ。
- 自律Eventの成功runは、具体的なTool・記録・予約・送信、または`notify-no-execution`のいずれかを必ず持つ。
- Actionも通知もない自律Eventを、型・Application・Persistenceの各境界で成功として表現できない。
- ActionとOutboxが同一transactionで確定し、再起動後も配送を再開できる。
- Concern、Relationship、Memory、Selfの差が、後続Eventの解釈またはAction差へ接続される。
- 旧Candidate Detection、Long-term Review、Interactionごとの二重後処理、旧autonomy認知経路が正規実行経路に残らない。
- typecheck、lint、unit、contract、integration、system、evaluation testが通る。
- Issue 148を置き換えるlive scenario gateが、事前固定した基準で全pair合格する。
- docs、runtime reset、migration、運用手順が新しい正規経路と一致する。

## 2. 設計判断

### 2.1 Event AssessmentとAgent Core

Meaning / Emotionの決定とDesire / Actionの決定を、既存の責務名を用いて次のように分離する。

```text
Event
  -> Context Selection
  -> Event Assessment（Meaning / Emotion決定）
  -> Agent Core（Desire / Action決定、Tool continuation）
  -> Commit（State patch / Log / Outbox）
```

- Event AssessmentはMeaningとEmotionを決定するが、Action、Tool、永続化成否、run終了を決定しない。
- Agent CoreはEvent、Self、State、MemoryとEvent Assessmentの結果を受け、Desireと最終Actionを決定する。
- Event AssessmentとAgent Coreは同じrun ID、deadline、model-call budget、traceを共有する。
- Event Assessmentの結果がAgent Core入力から欠落したrunを成功させない。
- Tool結果は同じAgent Core runへ戻し、別の認知pipelineやQueueへ送らない。
- Tool continuationではEvent Assessmentを再実行せず、確定済みのMeaning / EmotionとTool結果をAgent Coreへ渡す。

Event AssessmentとAgent Coreは別のLLM callとして実装し、Issue 148のtimeoutを踏まえて共通の期限とmodel-call予算で制御する。

### 2.2 目標Domain

正規の永続状態は次に絞る。

- `Self`: identity、disposition、selfStory、commitments
- `AgentState`: mood、concerns、relationships
- `Memory`: episodic memoryを基本とする単一保存経路
- `Event / Run / ToolExecution / StateChange`: Runtimeが付与する監査記録
- `Action / Outbox`: 実行結果と配送状態

Emotionは現在Eventへの認知結果とし、長期影響がある場合だけMood、Concern、Relationshipへ変換する。Evidence IDの転記は最小化し、Event、Tool、ActionのprovenanceはRuntimeが付与する。

### 2.3 Event種別

- Interaction Event: user、agent、external、time、system
- Autonomous Event: concern-due、idle、memory-trigger、external-change等。通常Agent Loopと必須Action契約を通る。
- Maintenance Event: reflection。State / Memory更新自体を内部Actionとし、通常の`notify-no-execution`義務とは分ける。
- Explicit Scheduled Task: ユーザー依頼の実行契約を保持し、自律判断と混同しない。

### 2.4 移行方針

- 新旧writerを同じproduction DBで同時稼働させない。
- 恒久的な互換層は作らない。
- 必要な既存データだけを一度限りのmigrationで変換する。
- migration不能な曖昧データは黙って補完せず、事前検査で停止して報告する。
- 旧testが旧内部構造だけを保証する場合、新構造を残す理由にせず削除または振る舞いtestへ置換する。

## 3. TDDで確認する公開seam

実装開始前に、次を公開seamとして合意する。testはprivate関数や内部collaboratorの呼出回数ではなく、ここから観測できる振る舞いを検証する。

1. `AgentLoop.process(event)`
   - EventからAction、Tool trace、State差分、Outbox結果まで。
2. `AutonomyRuntime.process(event)`または同等の自律Event入口
   - 成功runが必ず観測可能Actionを持ち、通知先欠落や配送不能を成功にしないこと。
3. `Reflection.process(event)`
   - ログからMemory圧縮、Concern / Relationship / Self更新を一つのmaintenance結果として確定すること。
4. Persistence transaction port
   - agent分離、optimistic lock、ActionとOutboxの原子性、冪等性、再claim。
5. Tool port
   - 権限、回数、deadline、同一入力反復禁止とTool continuation。
6. Evaluation runtime entrypoint
   - 実際のproduction compositionを通したstateful / baseline pair、artifact、gate終了値。

各作業単位は、一つのseamに対するfailing test、最小実装、test passの縦スライスで進める。構造整理はそのsliceがgreenになった後に行う。

## 4. 実装順序と依存関係

```text
IP-00 Target contract / baseline
  -> IP-01 Domain and Action invariant
  -> IP-02 Persistence and migration
  -> IP-03 Assessment-to-Core handoff
  -> IP-04 Canonical Agent Loop
       -> IP-05 Autonomous Events
       -> IP-06 Reflection
  -> IP-07 Remove legacy paths
  -> IP-08 Scenario evaluation and operational cutover
```

IP-05とIP-06はIP-04完了後に並行可能だが、旧経路の削除は両方の正規経路がgreenになってから行う。

## 5. 作業単位

### IP-00: Target contract、test seam、baselineの固定

目的:

- 方針3.1を「行動決定権の統合」として明文化する。
- 新しいAction、Event、State、Memory、Reflection契約を設計文書へ反映する。
- Issue 148 artifactと現行test結果を変更前baselineとして保存する。

主な対象:

- `note/agent-architecture-redesign-policy.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/TEST_STRATEGY.md`
- evaluation scenario / artifact metadata

TDD / 検証:

- test seamと振る舞い名を確定する。
- 現行の`pnpm verify`とlive評価を実行し、環境障害と設計上の失敗を分けて記録する。
- live評価のmodel、temperature、seed可否、timeout、prompt version、revisionを固定する。

完了条件:

- Event AssessmentとAgent Coreの責務境界に文書間の矛盾がない。
- scenario gateの閾値を実装変更前に固定している。

### IP-01: 新Domain契約と自律Action不変条件

目的:

- `Self`、`AgentState`、`Concern`、`Relationship`、`Memory`を目標モデルへ置換する。
- Interaction、Autonomous、Maintenance、Explicit Scheduled Taskを判別可能なEvent契約にする。
- 自律runの成功結果を、具体的Actionまたは`notify-no-execution`を必須とする型へ変える。

主な対象:

- `src/domain/contracts.ts`
- initial-self / persona schema
- contract fixture

TDD / 検証:

- Autonomous Eventで無Action結果をparseできない。
- `notify-no-execution`は宛先とユーザー向けcontentを持つ。
- Safety refusalとpersonality refusalを区別できる。
- Maintenance結果は通常自律Actionと混同されない。
- 他AgentのState / Memoryを入力に混入できない。

完了条件:

- 旧Motive / Candidate / memory kindを新規コードから要求しない。
- Actionなし成功を型で表現できない。

### IP-02: Persistence、transaction、one-time migration

目的:

- 新Domainのtable / repositoryを作る。
- Action、State change、log、Outboxの確定境界を再構成する。
- 旧状態を変換する一度限りのmigrationと事前検査を用意する。

主な対象:

- `src/infrastructure/persistence/`
- `drizzle/`
- reset / initialize operations
- integration tests

TDD / 検証:

- ActionとOutboxは同一transactionでcommitまたはrollbackする。
- State version競合、重複Event、Outbox再配送、post-crash再開を検証する。
- agent Aの状態をagent Bから取得・更新できない。
- migration前検査、成功変換、変換不能時の停止、再実行安全性を検証する。

完了条件:

- 新schemaだけで初期化、通常commit、再起動、resetが成立する。
- production切替手順に旧worker / scheduler停止確認が含まれる。

### IP-03: Event AssessmentからAgent Coreへの引き渡し

目的:

- Meaning / Emotionの責務分離を維持しつつ、Action判断へ確実に因果接続する。
- Issue 148の`wiring`失敗と二段callのtimeoutを解消する。

主な対象:

- `src/infrastructure/agent/`
- model output schema / prompt
- model-call budget / deadline
- Agent Harness contract tests

TDD / 検証:

- Event Assessment出力が同一run IDでAgent Core入力へ渡る。
- Assessment結果欠落、別run混入、不正schemaはAction確定前に失敗する。
- Agent CoreだけがActionとToolを選べる。
- Event Assessment、初回判断、Tool continuation、repairの全callを同じbudgetへ数える。
- 全call直前に入力上限と残りdeadlineを検査する。
- Event AssessmentとAgent Coreそれぞれの成功率、失敗段階、p95時間を計測可能にする。

完了条件:

- wiring failureが決定的contract / system testで再現されず、live smokeでも発生しない。
- 感情が発話文体だけでなくActionまたはState patchへ影響したことをtraceできる。

### IP-04: 正規Agent LoopとTool continuation

目的:

- EventからContext、Event Assessment、Agent Core、Tool、Commit、Outboxまでを一つのApplication serviceで調整する。
- Runtimeを意味判断から外し、権限・上限・transaction・配送保証へ限定する。

主な対象:

- `src/application/agent-loop.ts`（新規または既存Runtime置換）
- context selection
- tool registry / tool adapters
- runtime persistence port

TDD / 検証:

- 直接応答、personality refusal、system refusal、Tool後応答、Tool後内部Actionを縦スライスで追加する。
- Tool失敗後に別手段を選べる。
- 同一Tool / 同一入力の反復、上限超過、deadline超過を拒否する。
- Tool成功だけを理由に無言終了せず、Event契約に応じた最終Actionを要求する。
- commit後の配送失敗はrunを巻き戻さず、Outbox再試行へ残す。

完了条件:

- 通常Interactionの正規経路を一つのsequenceで説明できる。
- production compositionとevaluationが同じAgent Loopを利用する。

### IP-05: Event駆動の自律sourceと必須Action契約

目的:

- concern-due、idle、memory-trigger、external-changeをEvent sourceとして扱う。
- 自律Eventが観測不能な成功へ落ちる経路をなくす。

主な対象:

- scheduler / event publisher / router
- destination resolution
- Outbox delivery
- autonomy system tests

TDD / 検証:

- 各sourceが行動内容を命令せず、provenanceだけを持って通常Agent Loopへ入る。
- Tool、記録、予約、送信のいずれも選ばない場合は`notify-no-execution`を配送する。
- owner / default destinationを解決できない場合はretry可能な失敗になる。
- 同じ失敗手段をRecent Experienceから検出し、明らかな同一Tool入力をRuntimeが拒否する。
- Explicit Scheduled Taskは自律Eventと異なる実行契約を保つ。

完了条件:

- 成功した全自律runにAction recordがあり、必要な外部ActionにはOutboxがある。
- 通知不能、Actionなし、配送recordなしを成功とする経路がない。

### IP-06: Reflectionと個体化

目的:

- Interactionごとのcontinuity / memory後処理とCandidate / Long-term Reviewを、Event駆動のReflectionへ置換する。
- ExperienceをMemory、Concern、Relationship、Self Storyへ長期反映する。

主な対象:

- `src/application/reflection.ts`
- reflection model adapter
- log / memory / state repositories
- scheduler trigger

TDD / 検証:

- 事実logのMemory化、重複統合、Concern状態遷移、Relationship更新を検証する。
- 単発の弱い経験でSelfを大きく変更しない。
- 強い経験、反復、既存Selfとの矛盾を根拠にSelfを更新できる。
- 更新前Selfと根拠Memoryをaudit logへ残す。
- Reflectionの再試行と重複実行が同じ変更を二重適用しない。

完了条件:

- 長期更新の正規経路がReflection一つになる。
- 異なる経験列から形成された状態差が後続Agent Core入力に現れる。

### IP-07: 旧経路・schema・testの撤去

目的:

- 新経路がgreenになった後、旧構造を完全に削除する。

削除候補:

- Event AssessmentとAgent Coreの間にある重複Schema、Evidence転記、不要な中間変換
- `no-external-action`
- Motive / Motive Explorationの旧永続化とschedule
- Candidate Detection / Long-term Review
- continuity / memory / experience-integrationの重複job
- state-review / memory-recall / autonomy-reviewの認知別経路
- memory kind別writer
- LLMに転記させる型付きEvidence Ref
- 旧schema専用repository、prompt、fixture、debug UI表示

TDD / 検証:

- `rg`による残存識別子検査を補助に使い、公開seamの回帰testを正本とする。
- build、全test suite、migration fresh install、既存DB migrationを通す。

完了条件:

- 正規経路から旧moduleへ到達できないだけでなく、不要なmodule、table、job、testが存在しない。
- docsとdebug UIが新しい語彙だけを表示する。

### IP-08: Scenario評価、障害試験、切替

目的:

- 新構造が型だけでなく人格、自律性、個体化を改善したことを実証する。
- mainへmerge可能なrelease gateを完成させる。

決定的scenario:

- 同じEventに対しCommitment / Relationship差でActionが変わる。
- 怒りが反論、拒否、境界提示、修復要求、Relationship patchのいずれかへ影響する。
- 悲しみがMoodまたはConcernへ残り、後続Eventで変化する。
- 自律Eventは具体Actionまたは`notify-no-execution`へ必ず到達する。
- 通知先欠落、全Tool失敗、commit競合、配送障害、process crashを成功扱いにしない。
- 同じShared Dispositionから異なる経験を与えたAgentが、後続の同一Eventで異なるActionを選ぶ。

live pair:

- praise
- criticism
- boredom
- refusal
- curiosity / autonomous action
- individuality

live gate:

- 各pairのbaseline / statefulを事前固定回数実行する。初回はIssue 148と比較可能な各3回以上、merge判定は非決定性を評価できる反復数へ引き上げる。
- wiring、timeout、schema、Tool、delivery、evaluation failureをすべて分母に含める。
- Action type、Tool trace、delivery、State deltaを第一判定とし、semantic evaluatorだけへ依存しない。
- 全pairが事前固定した最小効果量と成功率を満たさなければmergeしない。
- artifactから同じ集計と終了値を再現できる。

最終検証:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:system
pnpm test:evaluation
pnpm eval:llm
```

完了条件:

- 全自動testとlive gateがgreenである。
- fresh DBとmigration済みDBの両方で起動、再起動、Outbox再送を確認している。
- 旧workerを停止した切替手順、rollback条件、artifact参照を記録している。

## 6. Branchとmerge方針

- 計画合意後、mainの最新revisionから専用branchを作る。
- 現在のworktreeにあるユーザー変更は、新branch作成前にcommit、stash、または別worktreeで保護する。
- 大規模変更でもIP単位の小さなcommitを作り、各commitは対応するtestと一緒にgreenにする。
- DB migrationを含むcommit以降は、旧production workerとの同時稼働を禁止する。
- mainへのmerge条件はIP-08の全gate合格とする。live gate不合格は「実装済み」ではなく未完了として扱う。

## 7. 主なリスクと対策

| リスク | 対策 |
|---|---|
| Event AssessmentとAgent Coreの二段callでtimeoutが増える | 同一budget / deadlineで管理し、段階別の時間と失敗をIP-03で計測する |
| 大規模schema変更で移行不能になる | IP-02で事前検査とone-time migrationを先に作る |
| 旧testを通すため互換層が残る | 公開seamの振る舞いtestへ置換し、IP-07で旧経路を削除する |
| `notify-no-execution`が定型spamになる | 理由、現在判断、次の再検討条件を含め、頻度はEvent source側で制御する |
| scenarioがprompt例の再生になる | 同一Observationのstate差比較、paraphrase、未見ケースを含める |
| fake testだけgreenでlive失敗が残る | production compositionをevaluationから直接使い、live gateをmerge条件にする |
| 新旧writerが同じDBを更新する | cutover前に旧bot / worker / scheduler停止を検証し、schema versionで起動を拒否する |

## 8. 計画上の未確定事項

実装開始前に次を確定する。

1. TDDの公開seamを本書3章の6点で合意するか。
2. live merge gateの反復数と最小効果量。Issue 148との比較用3回とは別に、最終判定に十分な回数を固定する。
3. 既存production DBのデータを移行するか、resetを許容するか。
4. 専用branchを現在のworktreeで作るか、ユーザーの未commit変更を保護して別worktreeで作るか。
