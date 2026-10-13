# Requirements

本書は現行実装の受入要求をまとめる二次資料である。概念・実装設計の一次資料は[`spec/`](../spec/)、簡略化の判断は[`note/agent-architecture-redesign-policy.md`](../note/agent-architecture-redesign-policy.md)を正とする。`docs/D3/`は対象外である。

## R1. 単一のAgent Loop

- Discord、Terminal、Agent間Message、External / Time / System / Internal Eventを同じ`AgentRuntime`へ入力する。
- Context構築、Event Assessment、Agent Core、Runtime検証、atomic commitを通常Eventの単一経路とする。
- Event Assessmentは現在EventのMeaningとFeelingだけを決め、Agent CoreはAssessmentからDesire、Action、任意のPatchを決める。
- Tool continuationは同じDeep Agent内で行い、別の認知pipelineへ分岐しない。
- 旧Candidate Detection、Long-term Review、Interaction単位のcontinuity / memory post-processを正規経路へ戻さない。

## R2. Self、State、Memory

- Current Selfはidentity、disposition、selfStory、commitmentsを持つ。
- Current Stateは任意のmood、concerns、relationshipsを持つ。
- Concernは継続中の関心、約束、未完了課題、感情的なしこりを統合し、任意の再検討時刻を持つ。
- FeelingはEvent内の短期反応とし、次のEventにも影響する場合だけStateまたはMemoryへ保存する。
- Memoryはepisodic / semantic / self-related、内容、重要度、時刻、subject、根拠Event / Memoryを保持する。
- Contextと更新対象へ別Agent所有のSelf、State、Recent Experience、Memoryを混入させない。
- 通常InteractionはSelfを直接変更しない。ReflectionによるSelf変更にはMemory根拠と理由を要求する。

## R3. 構造化Agent Core

- Deep Agentsの`createDeepAgent`と`toolStrategy`による`responseFormat`を本番経路で使用する。
- モデル向け出力は説明付きflat schemaとし、`desire`、`actionType`、Action固有field、任意のPatch fieldを返す。
- モデル向けJSON Schemaはproviderに不要なmetadataと文字列正規表現を持たず、Domain検証は厳密なZod schemaで別途行う。
- 初回の不正出力にはvalidation issueを与えて設定回数までrepairし、repair中は通常Toolを呼ばせない。
- repair後も不正な出力は成功commit、Receipt、Outboxを作らず、Run failureと観測済みTool実績を記録する。
- user-messageの既知の`action: string`誤出力だけは空でない応答へ復旧し、自律Eventへ同じfallbackを適用しない。

## R4. ActionとPatch

- `respond`は空でないcontentを配送する。
- `refuse`は空でないcontent、内部reason、`personality | system`のbasisを持つ。内部reasonは利用者向けpayloadへ露出しない。
- `notify-no-execution`は自律Eventで実行しない判断と理由を配送可能にする。
- `no-external-action`は成功したTool実行がある場合だけ許可し、単なる無行動として使わない。
- 自律Eventは具体的Tool実行または配送可能なActionなしに成功できない。
- Patchはmood、Concern 1件、Relationship 1件、即時Memory意図に限定する。
- Concernのupsert/removeと`reconsiderAt` scheduleを同期する。
- Concernは進展、満足点、現在のSelfにとっての価値に基づいて継続・変更・満足・放棄・削除する。進展のない同一内容を機械的に延長せず、一律の時間だけでも削除しない。
- `idle` Eventは`deepen`、`bridge`、`distant`の探索モードを持ち、成功した実行ごとに次のモードへ進む。失敗時は同じモードを再試行する。
- `bridge`と`distant`の探索も抽象語だけで完結させず、人物、作品、出来事、技術、場所など検証可能な具体的対象へ着地させる。

## R5. Contextと実行予算

- Contextの所有権、件数、文字列長、推定tokenを制限する。
- Recent Experienceと重複する通常優先度のepisodic Memoryを除外する。
- Agent Contextを4,500推定token以内、system promptとTool schemaを含むmodel入力を8,000推定token以内に収める。
- model call数、Deep Agent step数、Tool call数、deadlineをRun単位で制限する。
- 予算超過、未登録Tool、schema不正、権限違反、同一Tool・同一入力の反復を拒否する。

## R6. Tool

- 実装済みToolをRegistryからDeep Agentへ複数登録し、Eventごとの実行contextをmiddleware経由で渡す。
- Tool説明と全入力fieldへ、モデルが用途と値を判断できる具体的な説明を付ける。
- RuntimeはTool入力、権限、最大call数、冪等性、結果サイズ、実行記録を管理する。
- Tool Resultは同じAgent loopへ返すが、別Interactionとして自動再投入して二重実行しない。
- 失敗Toolだけを`no-external-action`成功の根拠にしない。

## R7. Event-driven autonomyとReflection

- 自律性は`idle`、`concern-due`等のEvent sourceで起動し、常時polling型の認知loopに依存しない。
- 明示的Scheduled Taskは利用者との約束としてConcernやMemoryと分離する。
- Schedulerはclaim / lease / retryを持ち、同一Agentの重複実行を防ぐ。
- ReflectionはEvent logをMemoryへ圧縮し、Concern、Relationship、Selfを整理するmaintenance処理とする。
- Reflectionは説明付きのモデル向け構造化出力、厳密なDomain検証、repair、入力上限を持ち、連続失敗時は最大24時間まで指数backoffする。

## R8. 永続化、配送、運用

- Event、Run、Assessment、Tool execution、State change、Memory、Receipt、Outboxを監査可能にする。
- Action、State Patch、即時Memory、Outboxを一つのDB transactionで確定する。
- Queue、Outbox、Tool実行はretryと重複実行に耐える。
- Agent単位advisory lock、state version、Tool権限、TTL、hop、rate limitを通常コードで保証する。
- PostgreSQL schemaは現行Domain契約だけを保持し、削除した旧互換tableや列を戻さない。
- Debug UIは観測用途に限定し、独自の書込み経路やAgent Loopを持たない。
- `.env`は実行時だけ読み込み、値をlog、test artifact、文書へ表示しない。

## 完了判定

自動testはschema、境界、失敗時の非commit、運用不変条件を判定する。実Ollama試験はモデルが応答・repairできることを、隔離PostgreSQLを使うproduction-like E2EはUIに依存せずContext、Tool binding、commit、Outbox配送まで通ることを確認する。

人格・状態差が行動差を生むという概念上の主張は、自動test合格だけでは完了としない。同一ObservationでSelf、Mood、Concern、Relationship、Memoryだけを変えた反復paired live evaluationと保存artifactで評価する。
