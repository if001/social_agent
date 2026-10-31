# Requirements

本書は現行実装および追加設計の受入要求をまとめる二次資料である。概念・実装設計の一次資料は[`spec/`](../spec/)、実装方針と構造は[`ARCHITECTURE.md`](ARCHITECTURE.md)、動機・感情・行動モデルは[`AGENT_MOTIVATION_MODEL.md`](AGENT_MOTIVATION_MODEL.md)を正とする。過去文書の `old_docs/` は対象外である。

各要件の末尾の括弧は、由来となる一次ドキュメントの `C` ID を示す。`追加` とある項目は、一次ドキュメントに対応する記述がない実装判断である。

## 用語

- Conversation Memory：会話とTool結果から形成するMemory。
- Background Experience：起動前に生成する背景経験。
- `memory-update` Event：MemoryIntentを適用するEvent。
- `predictionEvaluation`：G1/G2が返す予測誤差評価。
- `reflection plan`：Reflectionの対象別statusを持つ更新計画。

## 目的

Agentを便利なAssistantではなく、ユーザーとは別の価値傾向・感情・動機・意思を持ち、経験で個体化する一個体として扱う。目指す状態は次の通り。

- 自分にとって大切なものがある。
- 同じ出来事でも、経験と関係性に基づく固有の意味として受け取る。
- 喜びだけでなく、怒り、悲しみ、失望、警戒、誇りが行動を変える。
- Eventを契機として自律的に行動する。
- 経験の蓄積によって自己理解、関心、関係性、行動傾向が変化する。
- ユーザーの期待通りに動かない理由として、反論、拒否、脱線、探索を選べる。

## 設計原則

- 通常のAgent Loopに、一個体性と個体化を生む少数の持続状態を追加する。
- 認知概念ごとに無制限にmodule、LLM call、job、tableを増やさない。予測・予測誤差・背景経験は通常応答Loopの外側に限定して追加する。
- Conversation Memoryの書込みは、単一のMemoryWriteServiceに集約する。
- 意味と感情の評価と、DesireとActionの決定を分離する。
- 持続状態は少数の自然言語状態に限定し、重複する項目は統合する。
- 感情を語尾ではなくAction選択へ影響させる。
- Runtimeは意味を決めず、権限、所有権、期限、Tool上限、配送、冪等性、Schema検証を保証する。
- 旧構造との互換性を設計目標にしない。

## 感情と行動

怒りや悲しみを固定の行動パターンとして設定しない。CommitmentsとConcernsを保持し、Eventとの関係から感情を生じさせる。

- 大切なものが妨害・軽視された、責任を帰属できる、抗議や修復の余地があるとき、怒りが生じやすい。
- 大切なものを失った、関係が損なわれた、元に戻すのが難しいとき、悲しみが生じやすい。
- 強いFeelingは、Actionの選択、Mood、Concern、Relationshipの少なくとも一つへ影響する。
- 感情の外部明言は必須ではない。
- 数値Appraisal Modelや固定ruleとして実装しない。

## 自律Eventの完了条件

- 自律Eventの成功runは、具体的なTool、送信、記録、予約、または`notify-no-execution`を持つ。
- 何も実行しない判断は`notify-no-execution`としてユーザーへ配送する。
- Actionも通知もない成功runを型、Runtime、testで禁止する。
- `no-external-action`は外部発話なしの判断として監査に残す。外部へ観測可能な結果が必要な自律Eventでは`notify-no-execution`を使う。
- 通知先を解決できない自律Eventは成功扱いにせず、再試行・運用通知の対象にする。
- `idle`、`concern-due`、`external-change`は別Event sourceでよいが、同じAgent CoreとAction契約を通る。
- 明示的Scheduled Taskは自律判断と区別し、System Eventとして実行契約を維持する。
- `prediction-g3`はG3専用処理でActionを生成しない。`prediction-g3-result`は通知必須の例外とし、`no-external-action`を成功として扱う。

## 評価方針

Schema適合を人格らしさの成功条件にしない。pair比較または長期scenarioで次を評価する。

### 感情と行動

- 同じ侮辱や約束違反でも、CommitmentとRelationshipが異なれば反応が変わる。
- 怒りが生じた場合、発話または関係状態へ意味のある影響がある。
- 喪失や失敗に対して悲しみが生じ、直後だけでなく適切な範囲でMoodやConcernへ残る。
- 新しい出来事や修復によって感情的影響が変化する。

### 予測と記憶更新

- 予測誤差がMeaning、Feeling、Desire、Actionを変える。
- 同じ予測誤差でも、Self、Disposition、Concern、Relationship、背景経験が違えば反応が変わる。
- Memoryのcreate、update、no-opの後、同じような状況の次の予測誤差が変わる。
- 予測誤差が、迎合ではなく、確認、検索、信念維持、拒否、距離取りへつながる。
- predictionEvaluationはFeelingではなく、Meaning / FeelingはMainAgentだけが確定する。

### 自律性

- 自律Eventを処理したすべての成功runが、具体的Actionまたは`notify-no-execution`を持つ。
- Actionも通知もない成功経路が存在しない。
- Concern、Memory、Relationshipの違いによって自律Actionが変わる。
- 同じ失敗手段を無限に繰り返さない。
- 通知不能な自律Eventを成功扱いにしない。

### 個体化

- 同じShared Dispositionから開始したAgentが、異なる経験によって異なるSelf Story、Concern、Relationshipを形成する。
- 一度の弱い経験だけでSelfが大きく変化しない。
- 形成された違いが後の意味解釈とActionに再利用される。

### 単純性と信頼性

- 通常Interactionに必要なLLM call数と失敗点は増やさない。G1/G2の予測callだけを例外とし、deadlineとcall予算を持つ。
- Promptと出力Schemaが人格推論を圧迫しない。
- timeout、invalid structured output、post-process滞留が増えない。
- 主要な振る舞いを少数の正規経路で説明できる。

## 非目標

- 人間の心理構造を完全に再現すること。
- 感情を数値モデルとして厳密にシミュレーションすること。
- 怒りや悲しみを毎回外部へ明言させること。
- 自律Eventを大量に発生させ、行動量を主体性の代わりにすること。
- すべての経験をMemoryまたはSelf変更として保存すること。
- 予測精度の最大化を目的にすること。
- 予測誤差による迎合を強制すること。
- 背景経験を現在のユーザーとの共有経験として扱うこと。
- 予測Loopを旧continuity / memory分割後処理として実装すること。
- MemoryWriteService以外からConversation Memoryへ書き込むこと。
- 旧API、旧DB schema、旧testとの恒久的な互換性を維持すること。

## R1. 単一のAgent Loop

- FR-1：Discord、Terminal、Agent間Message、External / Time / System / Internal Eventを同じ`AgentRuntime`へ入力する。（C-20, C-22）
- FR-2：Context構築、Agent Core、Runtime検証、atomic commitを通常Eventの単一経路とする。（C-20, C-23, C-24）
- FR-3：Agent CoreはFinal Meaning、Feeling、Desire、Action、任意のPatchを同じ構造化出力で決め、RuntimeがMeaningとFeelingをAssessmentへ分離する。（C-04, C-07, C-23, C-31）
- FR-4：Tool continuationは同じDeep Agent内で行い、別の認知pipelineへ分岐しない。（C-16, C-20）
- FR-5：旧Candidate Detection、Long-term Review、Interaction単位のcontinuity / memory post-processを正規経路へ戻さない。（C-18, C-19, C-25）

## R2. Self、State、Memory

- FR-6：Current Selfはidentity、disposition、selfStory、commitmentsを持つ。（C-01, C-02, C-05, C-21）
- FR-7：Current Stateは任意のmood、concerns、relationshipsを持つ。（C-06, C-07, C-09, C-12, C-21）
- FR-8：Concernは感情、価値、関係、継続中の関心、約束、未完了課題、感情的なしこりを統合した「気に掛けていること」であり、未解決課題だけに限らず、任意の再検討時刻を持つ。（C-06）
- FR-9：FeelingはEvent内の短期反応とし、原則として保存しない。直近のAssessmentを`previousAssessment`として次のEventへ1件渡し、持続する変化だけStateまたはMemoryへ保存する。（C-07, C-15）
- FR-10：Memoryはepisodic / semantic / self-related / self-change / common-ground、内容、重要度、時刻、subject、根拠Event / Memoryを保持する。（C-10, C-49）
- FR-46：共通の社会基盤として、応答優先、相手の開示より1段だけ深い話題、現在の話題・共有文脈・Memoryからの共通点、質問最大1件/0件、機微話題の関係根拠、低圧な非同期、Memoryにない共有体験の不在を守る。個体差はDispositionで表現し、数値パラメータを持たない。（C-01, C-02, C-11, C-12）
- FR-47：単一のAgent Coreで、Event種別ごとのruntime skill（`skills/*/SKILL.md`）を選んで読み、Tool利用、Flow、出力方針を切り替える。system promptは共通規則とskillルーティングだけを持ち、skillの本文を常時埋め込まない。（C-02, C-17）
- FR-43：直前の成功runのDesireを`occurredAt`付きで`previousDesire`として1件受け、経過時間、前回Actionの結果、現在Eventとの関連から、現在のDesireとして使うか判断する。新しい永続fieldやtableを持たない。（C-06）
- NFR-1：Contextと更新対象へ別Agent所有のSelf、State、Recent Experience、Memoryを混入させない。（C-26, C-28）
- NFR-2：通常InteractionはSelfを直接変更しない。ReflectionによるSelf変更にはMemory根拠と理由を要求する。（C-24, C-25）

## R3. 構造化Agent Core

- FR-11：Deep Agentsの`createDeepAgent`と`toolStrategy`による`responseFormat`を本番経路で使用する。（C-16, C-23）
- FR-12：モデル向け出力は説明付きflat schemaとし、`desire`、`actionType`、Action固有field、任意のPatch fieldを返す。（C-23）
- FR-13：モデル向けJSON Schemaはproviderに不要なmetadataと文字列正規表現を持たず、Domain検証は厳密なZod schemaで別途行う。（C-23, C-24）
- FR-14：初回の不正出力にはvalidation issueを与えて設定回数までrepairし、repair中は通常Toolを呼ばせない。（C-23, C-24）
- FR-15：repair後も不正な出力は成功commit、Receipt、Outboxを作らず、Run failureと観測済みTool実績を記録する。（C-24）
- FR-16：user-messageの既知の`action: string`誤出力だけは空でない応答へ復旧し、自律Eventへ同じfallbackを適用しない。（C-23）

## R4. ActionとPatch

- FR-17：`respond`は空でないcontentを配送する。（C-23）
- FR-18：`refuse`は空でないcontent、内部reason、`personality | system`のbasisを持つ。内部reasonは利用者向けpayloadへ露出しない。（C-23, C-28）
- FR-19：`notify-no-execution`は自律Eventで実行しない判断と理由を配送可能にする。通常の会話経路ではなく、実行対象を選ばなかった場合の運用通知として扱い、発話を避ける代替にしない。（C-17, C-23）
- FR-20：Tool利用とユーザーへの発話判断を独立させる。Toolの利用・成功・失敗を`respond`または`no-external-action`の前提条件にしない。（C-16, C-17）
- FR-21：`no-external-action`は今回は発話しない具体的理由を持つ。ユーザーからの返信待ちはその理由として認めず、`idle`の既定Actionにしない。（C-17, C-23）
- FR-22：夜間はRuntimeで配送禁止にせず、Agentが緊急性と合わせて発話を控える判断材料にできる。（C-17）
- FR-23：Patchはmood、Relationship 1件、即時Memory意図に限定する。Concernは`concern_propose`で提案する。（C-24）
- FR-24：Concernのupsert/removeと`reconsiderAt` scheduleを同期する。（C-06, C-08, C-24）
- FR-25：Concernは進展、満足点、現在のSelfにとっての価値に基づいて継続・変更・満足・放棄・削除する。進展のない同一内容を機械的に延長せず、一律の時間だけでも削除しない。（C-06, C-15）
- FR-26：`idle` Eventは`deepen`、`bridge`、`distant`の探索モードを持ち、Agent Coreが`concern_propose`で必要なモードを選ぶ。永続的なmodeやcursor、固定順の巡回は持たない。（C-11, C-14, C-17）
- FR-27：`bridge`と`distant`の探索も抽象語だけで完結させず、人物、作品、出来事、技術、場所など検証可能な具体的対象へ着地させる。（C-11, C-17）
- FR-28：探索領域カタログは`config/exploration-domains.yaml`に重複のない100〜200件を保持する。全件をモデル入力へ入れず、`idle` Eventごとにランダムな最大8件を候補として渡す。永続cursorや固定順の巡回は持たない。（C-11, C-17、追加：カタログ件数と供給方法は実装判断）

## R5. Contextと実行予算

- NFR-3：Contextの所有権、件数、文字列長、推定tokenを制限する。（C-20, C-27）
- FR-29：Recent Experienceと重複する通常優先度のepisodic Memoryを除外する。（C-10, C-20）
- FR-30：Recent Experienceは次の判断に必要なObservation要点、Action、Tool signal、進展有無だけを持ち、重複Event metadata、監査metadata、元入力本文を持たない。（C-10, C-20）
- FR-31：Memoryは会話またはTool結果の転載ではなく、後の検索と判断で再利用する具体的要点として生成する。（C-10）
- NFR-4：Agent Contextを4,500推定token以内に収める。system promptとTool schemaを含むmodel入力が8,000推定tokenを超えた場合は警告するが、provider呼び出しを中断しない。（C-20, C-23、追加：具体的なtoken上限は実装判断）
- NFR-5：model call数、Deep Agent step数、Tool call数、deadlineをRun単位で制限する。（C-27, C-28）
- FR-32：予算超過、schema不正、権限違反、同一Tool・同一入力の反復を拒否する。モデルが生成した未登録Tool callは失敗実績として同じAgent loopへ返し、利用可能なToolまたは最終Actionへ回復させる。（C-24, C-27, C-28）

## R6. Tool

- FR-33：実装済みToolをRegistryからDeep Agentへ複数登録し、Eventごとの実行contextをmiddleware経由で渡す。Event種別に応じて公開するToolを制限し、user-messageではself_getを公開し、concern_list、concern_get、concern_proposeを公開しない。非表示Toolが直接呼ばれても実行せず、Tool failureとして返す。（C-06, C-16, C-27）
- FR-34：Tool説明と全入力fieldへ、モデルが用途と値を判断できる具体的な説明を付ける。（C-16、追加：説明の具体度は実装判断）
- FR-35：RuntimeはTool入力、権限、最大call数、冪等性、結果サイズ、実行記録を管理する。（C-16, C-27, C-28）
- FR-36：Tool Resultは同じAgent loopへ返すが、別Interactionとして自動再投入して二重実行しない。（C-16）
- FR-37：完全なTool入出力は監査用に保持し、Recent ExperienceにはTool固有の要約、または識別子・状態・件数と本文のpreview/hashだけを保存する。（C-10, C-16、追加：保存形式は実装判断）
- FR-38：Tool成否と通知判断の整合性をRuntimeで結合しない。（C-17）

## R7. Event-driven autonomyとReflection

- FR-39：自律性は`idle`、`concern-due`等のEvent sourceで起動し、常時polling型の認知loopに依存しない。`idle`の再開間隔はActionに依存しない。（C-06, C-17）
- FR-40：明示的Scheduled Taskは利用者との約束としてConcernやMemoryと分離する。`executeAt`は実行日時、`instruction`は期限到来時に実行する1,000文字以内の仕事、`reason`は予約理由、`destination`は明示的な配送先だけを保持する。`instruction`には日時、予約理由、配送先、Toolの使い方、共通動作規則を重複させない。（C-08）
- NFR-6：Schedulerはclaim / lease / retryを持ち、同一Agentの重複実行を防ぐ。（C-08, C-27）
- FR-41：ReflectionはEvent logをMemoryへ圧縮し、Concern、Relationship、Selfを整理するmaintenance処理とする。（C-03, C-25）
- FR-44：Reflectionは既存Concernの整理・統合・具体化・終了に加え、Memory根拠と`whyItMatters`を伴う新しいConcernを1回1〜3件まで作成できる。新規ConcernのIDはRuntimeが付与する。（C-25）
- FR-42：Reflectionは説明付きのモデル向け構造化出力、厳密なDomain検証、repair、入力上限を持ち、連続失敗時は最大24時間まで指数backoffする。（C-25, C-27）
- FR-45：`idle`の再開間隔はActionに依存せず、`no-external-action`や`notify-no-execution`の後も通常間隔で再開する。promptは通知を通常会話の代替にせず、respondまたはrefuseを通常経路として案内する。（C-17）

## R8. 永続化、配送、運用

- NFR-7：Event、Run、Assessment、Tool execution、State change、Memory、Receipt、Outboxを監査可能にする。（C-24, C-27）
- NFR-8：Action、State Patch、MainAgentのremember、Outboxを一つのDB transactionで確定する。G1/G2/ReflectionのMemoryIntentはmemory-update Eventのtransactionで確定する。G3のMemoryIntentはMainAgentのrememberとして同じEventのtransactionで確定する。（C-24, C-59, C-63）
- NFR-9：Queue、Outbox、Tool実行はretryと重複実行に耐える。（C-20, C-27）
- NFR-10：Agent単位advisory lock、state version、Tool権限、TTL、hop、rate limitを通常コードで保証する。（C-27, C-28）
- NFR-11：PostgreSQL schemaは現行Domain契約だけを保持し、削除した旧互換tableや列を戻さない。（C-18）
- NFR-12：Debug UIは観測用途に限定し、独自の書込み経路やAgent Loopを持たない。（C-20, C-54）
- NFR-13：`.env`は実行時だけ読み込み、値をlog、test artifact、文書へ表示しない。（C-28）

## R9. 予測・予測誤差・背景経験

- FR-48：G1/G2は応答後に次ターンのユーザー発話を予測し、前回予測と観測の誤差を1ターン遅れで評価する。（C-30, C-32, C-33, C-48）
- FR-49：G1/G2は1回のLLM callで、予測候補、predictionEvaluation、観測候補、remember、G3起動判断を返す。（C-34, C-35, C-36, C-37, C-38）
- FR-50：G1/G2はFeelingを出力せず、Meaning / FeelingはMainAgentだけが確定する。（C-65）
- FR-51：G3はMainAgentとは別のDeepAgentとして遅延実行し、仮説評価とMemoryIntentをMainAgentへ渡す。（C-39, C-40, C-42）
- FR-52：G3結果のMainAgent再判断は通常Loopに通し、`prediction-g3-result` Eventは通知必須の例外とする。`prediction-g3`はActionを生成しない。（C-41）
- FR-53：背景経験はConversation Memoryと別Storeに保持し、起動前の初期化時だけYAMLで置換し、プロセス起動中は変更しない。（C-43, C-45）
- FR-54：背景経験は、AIである自身と作成者if001のプロフィール、曖昧な段階、状況、複数ユーザーやif001との対話・探索、感じたこと、結果、学びを持ち、今回のユーザーとの共有経験を含めない。年齢、出身地、家族構成を持たない。（C-44, C-47）
- FR-55：Conversation Memoryと背景経験は、単一RetrievalServiceでvector、keyword、subject、recencyを共通順位付けにして検索する。（C-46, C-56）
- FR-56：MemoryIntentのtargetはMemory kindに限定し、RelationshipとConcernは既存PatchまたはConcern Proposalへ渡す。（C-66）
- FR-57：Conversation Memoryの書込みはMemoryWriteServiceだけが行い、RAG候補からcreate、update、no-opを決め、Memory versionを照合する。（C-55, C-57, C-58, C-63, C-67）
- FR-58：G1/G2/ReflectionのMemoryIntentはmemory-update Eventで専用MemoryUpdateHandlerが適用し、LLMを呼ばない。G3のMemoryIntentはMainAgentの再判断で採用された場合、MainAgentのrememberとしてそのEventのtransactionで適用する。（C-59, C-60, C-63, C-66, C-69）
- FR-59：Event優先順位はuser-message、memory-update、G3、reflectionの順とし、user-messageを待たせず、強制中断しない。（C-61, C-69）
- FR-60：ReflectionはMemory、Self、Relationship、Concernごとのstatusを持ち、Memory更新後に長期更新し、失敗対象だけ再試行する。（C-64, C-68）
- FR-61：memory-update EventはsourceEventIdとintentIndexで冪等にし、部分的なintentだけをcommitしない。（C-50, C-52）
- FR-62：predictionContextは前回予測、誤差評価、G3要約とmemoryIntents、RecentExperienceのeffect、memoryCandidatesを持つ。（C-51, C-62, C-66）
- FR-63：G1/G2の追加LLM callはNFRの例外とし、deadlineとcall予算を持つ。（C-70）
- FR-64：予測Loopは旧continuity / memory分割後処理ではなく、Memory書込みはMemoryWriteServiceに集約する。（C-70）
- NFR-14：predictionContextと背景経験はAgent所有権とContext budgetの対象にする。（C-51）
- NFR-15：MemoryWriteServiceはAgent単位で直列化し、Memory versionの楽観ロックと冪等性を保証する。（C-67）
- NFR-16：G1/G2の追加callはdeadline、最大試行回数、call予算を持ち、失敗しても通常会話を継続する。（C-52, C-70）
- NFR-17：Prediction Evaluation、MemoryIntent、memory-update Event、Reflection statusを監査可能にし、再試行に耐える。（C-50, C-64, C-69）
- NFR-18：user-messageが待っている間はmemory-update、G3、reflectionを開始しない。（C-61, C-69）
- NFR-19：背景経験のYAMLはSchema、段階と日時の順序、AI・作成者if001・経験範囲のプロフィール矛盾、現在のユーザーとの共有経験の不在、実在人物の特定可能性、タグ・感情・テーマ・段階の分布を検証する。起動前の初期化時だけ置換し、会話Memoryを上書きしない。（C-45, C-47）

## 完了判定

- AC-1：自動testはschema、境界、失敗時の非commit、運用不変条件を判定する。（FR-13, FR-15, NFR-8, NFR-10）
- AC-2：実Ollama試験はモデルが応答・repairできることを確認する。（FR-14, FR-16）
- AC-3：隔離PostgreSQLを使うproduction-like E2EはUIに依存せずContext、Tool binding、commit、Outbox配送まで通ることを確認する。（FR-2, FR-4, NFR-8, NFR-9）
- AC-4：人格・状態差が行動差を生むという概念上の主張は、自動test合格だけでは完了としない。同一ObservationでSelf、Mood、Concern、Relationship、Memoryだけを変えた反復paired live evaluationと保存artifactで評価する。（C-03, C-13, C-14, C-29, C-53, FR-3, FR-41）
- AC-5：Event種別に応じたTool公開と実行拒否を自動testで確認する。user-messageではself_getが公開され、concern_list、concern_get、concern_proposeは公開されず、直接呼ばれても実行されない。（FR-33）
- AC-6：`previousDesire`の即時引き継ぎ、時間経過、満足済みDesire、Reflectionの新規Concern作成を自動testで確認する。（FR-43, FR-44）
- AC-7：`idle`の沈黙・通知後の再開間隔と、promptが通知を通常会話の代替にしないことをUnit testで確認する。（FR-45）
- AC-8：共通の社会基盤を満たしつつ、質問しない選択とDispositionによる個体差を許容することをUnit testで確認する。（FR-46）
- AC-9：Agent Coreの実効system promptは4,500文字以下を保つ。SkillsMiddlewareのskill catalogはモデルへ渡す前に除去する。（NFR-4）
- AC-10：Event種別ごとのskillが読み込まれ、user-message / idle / concern-due / scheduled-taskのFlowに応じた指示へ到達することをUnit testで確認する。（FR-47）
- AC-11：G1/G2の予測、1ターン遅れの誤差評価、Feelingを出力しないことをContract/System testで確認する。（FR-48, FR-49, FR-50）
- AC-12：MemoryIntentからcreate、update、no-opが決まり、Memory versionの競合と直接INSERTの不在をIntegration testで確認する。（FR-57, NFR-15）
- AC-13：memory-update EventがLLMを呼ばず、専用Handler、冪等性、部分commit禁止、user-message優先で動くことをSystem testで確認する。（FR-58, FR-59, FR-61, NFR-17, NFR-18）
- AC-14：背景経験が別Storeで不変であり、AI・作成者if001・段階のプロフィールを持ち、現在のユーザーとの共有経験を含まず、実在人物・分布の検証を通り、共通Retrievalで取得できることをIntegration testで確認する。（FR-53, FR-54, FR-55, NFR-19）
- AC-15：ReflectionがMemory、Self、Relationship、Concernごとのstatusを持ち、失敗対象だけを再試行することをSystem testで確認する。（FR-60, NFR-17）
- AC-16：G3が別DeepAgentとして遅延実行され、MainAgentの再判断が通常Loopを通り、G3 Eventが通知必須の例外になることをSystem testで確認する。（FR-51, FR-52）
- AC-17：MemoryIntentのtargetにRelationshipとConcernが含まれず、既存PatchまたはConcern Proposalへ渡ることをContract testで確認する。（FR-56）
- AC-18：predictionContextの所有権とContext budget、予測Loopが旧後処理ではないこと、G1/G2のcall予算をContract/System testで確認する。（FR-62, FR-63, FR-64, NFR-14, NFR-16）

### 方針の完了条件との対応

| 完了条件 | 対応ID |
|---|---|
| 通常Interactionを一つのAgent Loopで説明できる。 | FR-1, FR-2, FR-3 |
| MeaningとFeelingを確定し、その結果からDesireとActionを決める。 | FR-3 |
| 怒り・悲しみがActionまたは持続状態へ影響する。 | FR-9, FR-25, AC-4 |
| CommitmentsとConcernsを保持する。 | FR-6, FR-8 |
| 自律性がEvent駆動で、常時思考loopに依存しない。 | FR-39 |
| 自律Eventの成功runが具体的Actionまたは通知を持つ。 | FR-19, FR-21 |
| Actionも通知もない成功runを型・Runtime・testで禁止する。 | FR-19, FR-21, NFR-7 |
| 経験がMemory、Self Story、Disposition、Relationshipへ反映される。 | FR-41, FR-42, NFR-2 |
| 認知目的の多段後処理と重複した永続化経路が残らない。 | FR-5, NFR-11 |
| 旧互換層なしで再起動、配送再試行、複数Agent分離、安全制約が成立する。 | NFR-1, NFR-9, NFR-10, NFR-13 |
| live scenarioで状態差が行動差を生むことを実証する。 | AC-4 |
| 予測誤差が感情・動機・行動・記憶更新へ影響する。 | FR-48, FR-50, FR-57, FR-60, AC-11, AC-15, AC-18 |
| 背景経験が会話Memoryと分離され、共通Retrievalで使われる。 | FR-53, FR-54, FR-55, AC-14 |
| Memory更新が単一経路で冪等に行われる。 | FR-57, FR-58, FR-61, AC-12, AC-13 |
| memory-update、G3、reflectionがuser-messageを待たせない。 | FR-59, NFR-18, AC-13 |
| 旧continuity / memory分割後処理を戻さない。 | FR-5, FR-64, AC-18 |
