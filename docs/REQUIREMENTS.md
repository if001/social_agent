# Requirements

本書は現行実装および追加設計の受入要求をまとめる二次資料である。概念・実装設計の一次資料は[`spec/`](../spec/)、実装方針と構造は[`ARCHITECTURE.md`](ARCHITECTURE.md)、動機・感情・行動モデルは[`AGENT_MOTIVATION_MODEL.md`](AGENT_MOTIVATION_MODEL.md)を正とする。過去文書の `old_docs/` は対象外である。

各要件の末尾の括弧は、由来となる一次ドキュメントの `C` ID を示す。`追加` とある項目は、一次ドキュメントに対応する記述がない実装判断である。

## 用語

- Conversation Memory：会話とTool結果から形成するMemory。
- Background Experience：起動前に生成する背景経験。
- `memory-update` Event：MemoryIntentを適用するEvent。
- `predictionEvaluation`：G1/G2が返す予測誤差評価。
- `reflection plan`：Reflectionの対象別statusを持つ更新計画。
- `message-received` Event：human又はallowlist peerからの社会的入力を、送信者種別と宛先性を添えて正規化した通常Event。
- Observation Gate：allowlist peerの観測投稿を、通常Agent Loopへ渡すかだけを判定する軽量な前段処理。
- 直近自己発話：Observation Gateが同一peerへの反復を避けるために使う、最新の完了済み`respond`を自然言語だけへ縮約した最大1件のview。Event / Run / Discord IDは含めない。
- Memory Formation：固定された未統合Event群から、将来再利用する新しいConversation Memoryを形成するReflection内の処理。
- Memory Reconciliation：再活性化された既存Conversation Memoryを、関連Memory・Eventとの局所的な照合で補強、訂正、分割または維持するReflection内の処理。

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
- `no-external-action`は各Eventの発話契約が許す場合に、Actionを配送せず完了する。内部Eventと会話目的が満たされた`peer/direct` Eventで明示的に使い、idleでは選択せず、外部へ観測可能な結果が必要な自律Eventでは`notify-no-execution`を使う。
- 通知先を解決できない自律Eventは成功扱いにせず、再試行・運用通知の対象にする。
- `idle`、`concern-formation`、`concern-due`、`external-change`は別Event sourceでよいが、同じAgent CoreとAction契約を通る。
- 明示的Scheduled Taskは自律判断と区別し、System Eventとして実行契約を維持する。
- `prediction-g3`はG3専用処理でActionを生成しない。`prediction-g3-result`は通常Agent Loopで再判断し、Agent自身に共有する動機がある場合だけ発話する。`no-external-action`を成功として扱う。

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

- FR-1：Discord、Terminal、Agent間Message、External / Time / System / Internal Eventを同じ`AgentRuntime`へ入力する。新規の社会的受信は`message-received`へ正規化する。peer/observedだけは通常Loop前のFR-91を通る。（C-20, C-22）
- FR-2：Context構築、Agent Core、Runtime検証、atomic commitを通常Eventの単一経路とする。FR-91で`engage`されたpeer/observedはこの経路へ一度だけ入る。（C-20, C-23, C-24）
- FR-3：Agent CoreはFinal Meaning、Feeling、Desire、Action、任意のPatchを同じ構造化出力で決め、RuntimeがMeaningとFeelingをAssessmentへ分離する。（C-04, C-07, C-23, C-31）
- FR-4：Tool continuationは同じDeep Agent内で行い、別の認知pipelineへ分岐しない。（C-16, C-20）
- FR-5：旧Candidate Detection、Long-term Review、Interaction単位のcontinuity / memory post-processを正規経路へ戻さない。（C-18, C-19, C-25）

## R2. Self、State、Memory

- FR-6：Current Selfはidentity、disposition、selfStory、commitmentsを持つ。selfStoryは現在の自己理解・継続する役割・現在の変化だけを600文字以内で表す。commitmentsは守るもの・続ける関係・譲らないことを各400文字以内、最大12件で表す。出来事の時系列と調査結果はMemory、実行時刻と仕事はScheduled Task、継続的な関心はConcern、今回のDesireは各Self fieldへ残さない。（C-01, C-02, C-05, C-21）
- FR-7：Current Stateは任意のmood、concerns、relationshipsを持つ。（C-06, C-07, C-09, C-12, C-21）
- FR-8：Concernは感情、価値、関係、約束、未完了課題、感情的なしこりから生じ、複数Eventにわたって現在も「気に掛けている」関心・動機である。未解決課題や疑問文だけに限らず、任意の再検討時刻を持つ。一件には一つの関心・動機の核だけを保持する。出来事・発見・根拠・会話経緯はMemory / Event Experience、今回だけの行為はDesire、実行日時・詳細手順はScheduled Task、長期に守る原則・役割・約束はCommitment、相手との安定した前提はRelationshipを正本とし、Concern本文へ履歴として複製しない。旧契約で保存されたactive Concernは、IDをLLMへ渡さず一件ずつ`keep | normalize`し、同じ関心の核を現行writer契約へ収束させられる。statusと`reconsiderAt`は変更せず、分割・作成・終了は行わない。（C-06）
- FR-9：FeelingはEvent内の短期反応とし、原則として保存しない。直近のAssessmentを`previousAssessment`として次のEventへ1件渡し、持続する変化だけStateまたはMemoryへ保存する。Moodは、次の複数Eventの意味づけと行動の調子を変えるAgent自身の持続的な感情的構えだけを120文字以内の一文で持つ。出来事、探索テーマ、固有名詞、ユーザー、返答待ち、約束、Concern、行動計画、願望、理由はMoodに保存せず、該当するExperience、Memory、Concern、Relationship、Desireへ分ける。持続する変化がなければMoodを更新しない。（C-07, C-15）
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
- FR-16：`message-received`のhuman/directで既知の`action: string`誤出力だけは空でない応答へ復旧し、自律Event、peer入力、観測へ同じfallbackを適用しない。（C-23）

## R4. ActionとPatch

- FR-17：`respond`は空でないcontentを配送する。（C-23）
- FR-18：`refuse`は空でないcontent、内部reason、`personality | system`のbasisを持つ。内部reasonは利用者向けpayloadへ露出しない。（C-23, C-28）
- FR-19：`notify-no-execution`は自律Eventで実行しない判断と理由を配送可能にする。通常の会話経路ではなく、実行対象を選ばなかった場合の運用通知として扱い、発話を避ける代替にしない。（C-17, C-23）
- FR-20：Tool利用とユーザーへの発話判断を独立させる。Toolの利用・成功・失敗を`respond`または`no-external-action`の前提条件にしない。（C-16, C-17）
- FR-21：`no-external-action`は各Eventの発話契約が許す場合に、Actionを配送せず完了する。内部Event、会話目的が満たされた`peer/direct`、認知後も具体的な発話動機がない`peer/observed`で明示的に使い、idleでは選択できず、情報が不十分なら`respond`で不十分な旨を伝える。ユーザーからの返信待ちを理由にしない。（C-17, C-23、更新）
- FR-22：設定された夜間時間帯はidle Eventを発生させず、次の許可時刻へ再スケジュールする。他のEventや配送は禁止しない。（C-17）
- FR-23：Patchはmood、Relationship 1件、即時Memory意図に限定する。Concernは`concern_propose`で提案する。（C-24）
- FR-24：Concernのupsert/removeと`reconsiderAt` scheduleを同期する。（C-06, C-08, C-24）
- FR-25：Concernは進展、満足点、現在のSelfにとっての価値に基づいて継続・変更・満足・放棄・削除する。Concern Activityで作成、focus、progress、derive、review、status変更を監査し、`CONCERN_STALE_AFTER_MS`（既定30日）と`CONCERN_STALE_MIN_REFLECTION_SESSIONS`（既定2）を満たすstale候補が、当該Sessionでreview / focus / progress / derive / status変更に至らず、future `reconsiderAt`も明示的継続reviewもない場合だけRuntimeが`abandoned`へ移す。ユーザー未返信、Concern件数、一律の時間だけでは終了させない。導入前のConcernはmigration時点をbaselineとし、過去履歴を推測しない。（C-06, C-15）
- FR-26：`idle` Eventは既存active Concernを1件Focusとして選び、探索・考察・共有を行う。`deepen`、`bridge`、`distant`は`concern_propose`の探索モードであり、永続的なmodeやcursor、固定順の巡回は持たない。（C-11, C-14, C-17）
- FR-68：`concern-formation`は一定間隔で起動する内部Eventであり、ユーザーへの発話ではなく関心地図の形成を担う。Self、Memory、Background Experience、Relationshipから根拠のある独立Concernをcreateできるほか、`exploration-domains` の候補を用いて既存Concernだけでは生まれにくい異領域のConcernをcreateできる。件数だけを根拠に作らず、createできない場合はno-external-actionで終える。（C-06, C-11, C-14, C-17）
- FR-69：`concern-due`は具体的な`reconsiderAt`、新しいMemory、又はexternal-changeを契機に既存Concernを再評価する。継続・方法変更・終了に加え、別の問い・対象・方法が残ればderive + forkする。不進展・予測誤差は、起動済みEventでの再評価材料として使う。独立Concernの幅を作る責務は持たない。（C-06, C-14, C-17）
- FR-27：`bridge`と`distant`の探索も抽象語だけで完結させず、人物、作品、出来事、技術、場所など検証可能な具体的対象へ着地させる。（C-11, C-17）
- FR-28：探索領域カタログは`config/exploration-domains.yaml`に重複のない100〜200件を保持する。全件をモデル入力へ入れず、`concern-formation` Eventごとにランダムな最大8件を候補として渡す。永続cursorや固定順の巡回は持たない。（C-11, C-17、追加：カタログ件数と供給方法は実装判断）
- FR-66：`idle`、`concern-due`の自律発話は、Concern、Self、Memory、Mood、探索結果からAgent自身が扱いたい具体的対象を選ぶ。ユーザーの現在話題・好み・共有文脈は届き方を調整する任意の材料であり、話題選択の前提にしない。唐突な話題転換を許容するが、Desireには対象が現在の個体状態・経験と結び付く理由を含める。（C-01, C-03, C-14, C-17）
- FR-67：`idle`、`concern-due`では、ユーザーの未返信・返答待ち・連投回避を待機、沈黙、Concernの減衰・終了の根拠にしない。各EventでAgent自身が探索・調査・考察・記録・共有から行動を選び、必ずユーザーへ発話する。複数の独立したactive Concernを並行して持つことを自然な通常状態とする。独立Concernの幅はconcern-formationがcreateし、既存Concernの派生はconcern-due / external-changeがderive + forkする。idleは行動中に強く残った独立Concernだけをcreateでき、件数閾値だけで機械的に作らない。件数を減らすためだけに置換・終了しない。（C-01, C-03, C-06, C-14, C-17）
- FR-70：`idle`がユーザー自身への関心・質問を扱うときは、既知の予定、試み、関心、未完了の話題と直近の質問を必要な範囲で確認する。Memoryに根拠があり同じ問いの再送でなければ、自律的な探索・共有に加えて最大1件、その人自身について自然に尋ねられる。ユーザー文脈の取得は毎回の話題選択の前提にしない。探索対象とDesireは、会話Memory、Concern、Self、Mood、探索結果、またはBackground Experienceの出来事・Feeling・lessonの少なくとも一つに根拠を持つ。Background Experienceを現在のユーザーとの共有経験として扱わない。（C-01, C-03, C-10, C-14, C-17, C-45）

## R5. Contextと実行予算

- NFR-3：Contextの所有権、件数、文字列長、推定tokenを制限する。（C-20, C-27）
- FR-29：Recent Experienceと重複する通常優先度のepisodic Memoryを除外する。（C-10, C-20）
- FR-30：Recent Experienceは次の判断に必要なObservation要点、Action、Tool signal、進展有無だけを持ち、重複Event metadata、監査metadata、元入力本文を持たない。（C-10, C-20）
- FR-31：Memoryは会話またはTool結果の転載ではなく、後の検索と判断で再利用する具体的要点として生成する。（C-10）
- NFR-4：Agent Contextを4,500推定token以内に収める。system promptとTool schemaを含むmodel入力が8,000推定tokenを超えた場合は警告するが、provider呼び出しを中断しない。（C-20, C-23、追加：具体的なtoken上限は実装判断）
- NFR-5：model call数、Deep Agent step数、Tool call数、deadlineをRun単位で制限する。探索用のgraph safety上限が先に到達した場合は、残した1 model callで、それまでに取得・記録済みのTool結果を根拠に通常Toolなしの最終Actionを試みる。この回復も失敗した場合だけRunを失敗にする。（C-27, C-28）
- NFR-21：RuntimeはRunまたはmaintenance Session単位でRAG query数、LLM call数、入力・出力token、並列数を計測・監査し、予算として強制する。RAG queryは数百件まで許可するが、1,000件以上を計画・実行しない。通常のLLM callを数百回行う設計にしない。入力・出力が小さく、単一候補の自然言語判断だけを行う軽量LLM callは、明示的な共有予算の範囲で100回未満まで許可できる。任意の`peer/observed`のGate失敗は通常Runを始めず`ignore`として監査する。上限到達時は、取得済み結果による決定論的な完了・no-op・部分成功へ移行し、無制限な再試行や全件走査をしない。（追加：検索と軽量判断を活用しつつ、数千回規模の検索・数百回規模のLLM実行を防ぐため）
- NFR-22：意味、意図、感情、自然言語の要約・解釈、曖昧な経験の統合など、自然言語の理解を要する判断はLLMが担う。特定語、禁止語、正規表現又は単純な文字列一致を意味判定の条件として、分類、除外、状態変更又はAction選択を確定しない。一方、ID・所有権・権限・時刻・範囲・状態遷移・冪等性・予算・pagination・重複除去・閾値判定・候補の順位付けはRuntimeが決定論的に担う。Hybrid RAG、embedding近傍検索、cluster化はLLM呼出しを代替できる機械的な候補取得・集約として使ってよいが、Agentの意味づけそのものを確定しない。（C-18, C-20, C-27、追加：認知判断とRuntime責務を分離するため）
- FR-32：予算超過、schema不正、権限違反、同一Run内での同一Tool・同一入力の反復を拒否する。重複拒否は既取得結果の利用、入力・Toolの変更、または最終Actionへの移行を示す機械可読な失敗結果を同じAgent loopへ返す。過去Runでの同一入力だけを理由に実行を拒否しない。モデルが生成した未登録Tool callも同じAgent loopへ失敗実績として返す。（C-24, C-27, C-28）

## R6. Tool

- FR-33：実装済みToolをRegistryからDeep Agentへ複数登録し、Eventとinteractionの実行contextをmiddleware経由で渡す。`message-received`のdirectはhuman / peerを問わずself_getを公開し、concern_list、concern_get、concern_proposeを公開しない。`interaction_context_get`は当該Eventの解決済みhuman又はpeer subjectだけのMemory、Relationship、直近の問いを返し、LLMはIDを指定しない。peer/observedは返信義務を持たず、同じ相手文脈を取得できる。非表示Toolが直接呼ばれても実行せず、Tool failureとして返す。（C-06, C-16, C-27）
- FR-34：Tool説明と全入力fieldへ、モデルが用途と値を判断できる具体的な説明を付ける。（C-16、追加：説明の具体度は実装判断）
- FR-35：RuntimeはTool入力、権限、最大call数、冪等性、結果サイズ、実行記録を管理する。（C-16, C-27, C-28）
- FR-36：Tool Resultは同じAgent loopへ返すが、別Interactionとして自動再投入して二重実行しない。（C-16）
- FR-37：完全なTool入出力は監査用に保持し、Recent ExperienceにはTool固有の要約、または識別子・状態・件数と本文のpreview/hashだけを保存する。（C-10, C-16、追加：保存形式は実装判断）
- FR-38：Tool成否と通知判断の整合性をRuntimeで結合しない。（C-17）

## R7. Event-driven autonomyとReflection

- FR-39：自律性は`idle`、`concern-due`等のEvent sourceで起動し、常時polling型の認知loopに依存しない。`idle`の再開間隔はActionに依存しない。（C-06, C-17）
- FR-40：明示的Scheduled Taskは利用者との約束としてConcernやMemoryと分離する。`executeAt`は実行日時、`instruction`は期限到来時に実行する1,000文字以内の仕事、`reason`は予約理由、`destination`は明示的な配送先だけを保持する。`instruction`には日時、予約理由、配送先、Toolの使い方、共通動作規則を重複させない。（C-08）
- NFR-6：Schedulerはclaim / lease / retryを持ち、同一Agentの重複実行を防ぐ。（C-08, C-27）
- FR-41：Reflectionは通常Action・外部探索・日常的Concern消化を行わず、Memory、Concern、Relationship、Self、Moodを長期統合するmaintenance処理とする。Session開始時に対象Event範囲を固定し、Memory Formation、Memory Reconciliation、Concern / Relationship、Self / Moodの順で対象別Reflectorを実行する。Self / Mood Reflectorは、持続する感情的構えの変化があるときだけFR-9のMoodを出し、今回のEvent、探索、対人状況、待機、計画を要約しない。（C-03, C-25）
- FR-44：Reflectionは既存Concernの整理・統合・具体化・終了に加え、Memory根拠と`whyItMatters`を伴う新しいConcernを1回1〜3件まで作成できる。新規ConcernのIDはRuntimeが付与し、作成ActivityへReflection Sessionと根拠Memoryを対応付ける。（C-25）
- FR-42：各Reflectorは説明付き構造化出力、厳密なDomain検証、repair、対象別のretry / backoffを持つ。repairは初回と同じ固定入力・対象schema・検証エラーを渡し、通常読み取りToolを無効にする。LLM出力は永続ID・局所参照を含めず、根拠と更新対象はRuntimeが入力範囲と検索結果から解決する。Self / Mood Reflectorは全Self fieldの意味と対象外をdescriptionで示し、完全なSelfとMemory根拠・理由だけを返す。Relationship Reflectorは現在本文と操作だけを返し、Runtimeが本文に一意一致するcanonical human又はpeer Relationshipだけを更新する。読み取りToolで必要な根拠を取得し、連続失敗時は最大24時間まで指数backoffする。（C-25, C-27）
- FR-45：`idle`の再開間隔はActionに依存せず、`notify-no-execution`の後も通常間隔で再開する。promptはidleでrespondまたはrefuseを必須とし、no-external-actionを禁止する。（C-17）
- FR-76：発話は`message-received`、`idle`、`concern-due`、`external-change`、明示的配送先を持つ`scheduled-task`、および`prediction-g3-result`の通常Agent Loopで許可する。`idle`と`concern-due`は発話またはrefuseを必須とする。これは未返信・返答待ち・連投回避を抑制理由にしない配送方針であり、話題とDesireはAgent自身が選ぶ。`peer/direct`とFR-91で`engage`されたpeer/observedは、今回の具体的な問い、判断を変える差分、Concern又は約束の次行為、自発表現が残る時だけ発話し、それ以外は`no-external-action`を選べる。長期協力、礼儀、採用、感謝、同意、言い換えは単独の発話根拠にしない。発話時は独立共有、source返信、明示peer発話を区別する。他の許可EventもAgent自身の動機により発話しないことができる。`concern-formation`、`memory-update`、`reflection`はmaintenance処理であり、外部へ発話しない。（C-06, C-16, C-17、更新）
- FR-77：全LLM経路は、永続canonical ID、Discord ID、local handle、局所参照、cursor、その他の永続Recordを指すIDを入力・出力・repair payload・Tool結果へ含めず、自然言語上のviewと候補だけを扱う。Event監査の生actor IDはEvent / Runに残すが、Context Builderがmodel-facing actor viewから除く。自然言語のpeer表示名は候補として扱えるが、Runtimeだけが固定範囲、検索結果、所有権、時刻、種別を用いて根拠と更新対象を解決する。ID付与、検索、更新、永続化を担う。解決できない、曖昧な、又は対象外の候補はcommitしない。（追加：LLMのID幻覚を永続化・参照・更新へ伝播させず、根拠選択を再現可能なRuntimeの責務にするため）
- FR-82：Experience Integrationは完了済みsource Eventを唯一の直接根拠として、Event固有経験、Memory候補、actorに束縛されたRelationship候補、Mood候補を意味づける。LLMは`content`、`reason`、種別、視点、Relationship本文だけを返し、Runtimeがsource Event、解決済みinteraction subject、既存Relationshipからcanonical根拠・subject・更新対象を解決する。Relationship候補のoperation、現在本文、更新本文、理由は全て説明付きschemaで返す。Mood候補はFR-9の持続的な感情的構えだけとし、今回のEventや探索の進展、相手への届け、返答待ち、次の行動を混在させない。owner humanだけを`user-main`へ、allowlistに一意一致するpeerだけを`agent:<agentId>`へ正規化する。owner外human、未登録Bot、actor不在、対象不一致、複数一致はRelationship、Memory subject、Event subjectを書かない。peerについてのMemoryは、peerの客観的な視点・事実を代理保存せず、当該Agentがpeerの発言・観測をどう受け取ったかという`self / self-guidance`の経験としてpeer subjectを付与する。Relationship本文は現在の関係の型、安定した前提、未解決の約束だけを400文字以内で保持する。（追加）
- FR-88：Discord Adapterはowner humanの自Bot宛mentionを`message-received/human/direct`、allowlist peerの自Bot宛mentionを`message-received/peer/direct`、allowlist peerの同一観測channelへの非mention投稿を`message-received/peer/observed`として受理する。self、owner外human、allowlist外BotはEventを作らず、direct投稿をobservationとして二重作成しない。peer/observedはFR-91で`ignore`又は`engage`される。モデルには本文、`senderKind`、`addressing`、自然言語のpeer表示名だけを渡し、actor ID、Discord ID、channel、reply metadataはRuntime監査に留める。Botごとの初期Stateはallowlist peerごとに異なるRelationshipを持てるが、初期関係は相手の客観的な人格や未経験の共有史を断定しない。`respond.content`はhuman/directでは人間、peer/directではsource peerへのmention、peer/observedと自律Eventでは宛先を持たない共有channelへの非mention発話へ配送する。peer/directのmention自体は配送義務でなく、会話目的が満たされれば`no-external-action`で配送しない。peer/observedのsource投稿へ返答する時は`respond.observedReply.content`だけを出力し、Runtimeが元投稿へのDiscord reply/threadとして配送する。`respond.peer: { name, content }`は明示peerへのmentionであり、RuntimeがBotごとの設定内で一意にpeer・channel・Discord IDを解決する。配送Adapterは同じallowlistを再検証する。各Botは自分が配送に成功したDiscord message IDだけをprocess内の短期Mapへ記録し、allowlist peerがそのmessageへreplyした時だけcorrelation IDを継承しhopを1増やす。entryは送信envelopeのexpiryで失効し、再起動、Map miss、reply先なし、受理済みowner human投稿は新規 ingress (`hop: 0`) とする。allowlist外BotはMapの有無にかかわらずEventを作らない。未登録・曖昧・自己参照・channel未設定・配送metadata不正・interaction不一致・hop超過ではその配送を行わないが、同一commitの別の許可済み配送は維持する。`agent_send`のような任意Agent IDを受ける内部配送ToolはBot会話の経路にせず、Agent Coreへ公開しない。（C-09, C-16, C-17, C-20, C-27、更新）
- FR-90：`message-received`は`senderKind: human | peer`と`addressing: direct | observed`を持つ単一の社会的Eventである。human/directとpeer/directは同じAgent Core、Assessment、Feeling、Desire、Action、Experience Integration、Concern lifecycleを通る。peer/directではDesireが会話目的を表し、目的が満たされた定型終話は通常Eventとして`no-external-action`で完了・監査する。peer/observedもFR-91が`engage`した場合だけ同じ経路を通るが、`engage`は認知価値であり発話義務ではない。peer/observedのDesireは具体的な問い、判断を変える差分、次行為又は自発表現に結び付け、長期協力・礼儀・合意だけで発話しない。`ignore`は受信監査だけを残し、Run、Assessment、Action、Experience Integration、Concern lifecycle、Projection、Reflection・Retrieval対象を作らない。Concern、Memory、Relationshipを人間用／peer用の別モデル又は別認知pipelineへ分割しない。peer/observedのActionは、独立共有発話、source投稿への返信、明示peer発話を配送上だけ区別する。`user-message`は既存監査Recordの読取り互換だけに残し、新規Eventのwriterは使用しない。（C-09, C-16, C-17、更新）
- FR-91：Runtimeはpeer/observedだけに、本文、自然言語のpeer表示名、短いSelf view、現在Mood、当該peerとのRelationship、最大3件の関連Memory、最大3件のactive Concern、同一peerへの直近自己発話を上限付きID-free viewとして渡すObservation Gateを実行する。Gateは返信義務・有用性でなく、具体的な未解決の問い、判断を変える反論・訂正・新事実、Concern又は約束の次行為、自発表現のいずれかがAgent自身を動かしたかで`ignore | engage`と短い理由を返す。長期協力、礼儀、採用、感謝、同意、言い換え、予定確認だけを`engage`根拠にしない。`ignore`はEventとGate判断を原子的に監査保存し、通常Agent Loop、Tool、Outbox、Experience Integration、Event Projection、Reflection・Event Retrievalの候補を作らない。`engage`は同じEventを通常Loopへ一度だけ渡す。GateのLLM・RAG入力、出力、call数、失敗は監査し、provider又はschema失敗は`ignore`としてfail-closedする。（C-16, C-17、更新）
- FR-92：FR-88の旧複数route表現を置き換え、`respond`は唯一の`content`と任意の自然言語`recipient`だけを持ち、一Actionから一つのOutbox配送だけを作る。recipient省略時はhuman/directを人間、peer/directをsource peerへのmention、peer/observedをsource投稿へのreply、自律EventをEvent既定先へ配送する。`user`はowner user、`channel`は非mention通常投稿、それ以外はallowlist peer表示名としてRuntimeが一意解決する。`user`と`channel`はpeer表示名の予約語とし、複数本文・複数宛先・同時配送を出力schemaとRuntimeの両方で許可しない。（C-09, C-16, C-17, C-27、追加）
- FR-93：Concernの現在状態はAgentごとの`concerns` relationを正本とし、`concern_activities`の履歴とは分離する。明示的なremoveは履歴を失う物理削除ではなく`deleted_at`による論理削除とし、通常の判断入力、Tool、Reflectionは論理削除済みConcernを取得しない。Activityの所有AgentはConcernから導出し、重複したAgent IDや旧State JSONを正本として保持しない。（FR-6, FR-8, FR-25, NFR-7, NFR-8）
- FR-89：Memoryの所有者は`agent_id`、対象はRuntime解決済みの`memory_subjects.subject_id`、因果根拠はEvent / Run / Memory evidenceで表す。Agent IDと任意情報源を兼ねる`sourceAgentId`は持たず、伝聞の説明が必要な場合は自然言語のMemory本文又は監査Eventに残す。既存値はmigrationで除去する。（C-09, C-10, C-24）
- FR-83：G1/G2は予測候補、予測誤差の解釈、G3起動判断だけを出力し、Memory候補、観測候補、subject又は根拠Recordを出力しない。長期経験の保存はExperience Integration又はG3後の通常Agent Loopが担う。（追加）
- FR-84：G3は仮説、発見、Memory候補を自然言語で返す。Runtimeはsource EventとG3実行中の非公開Tool evidence poolに限定して候補`content + reason`をHybrid Retrievalし、根拠Event・subject・更新可否を解決する。仮説評価の根拠もRuntimeが対応付け、根拠なしのMemory候補はno-op、根拠なしの仮説はundecidableとする。（追加）
- FR-85：Agent CoreはAssessment、Desire、Actionだけを確定し、Memory、Relationship、Mood又は永続Record更新を直接出力しない。repairは初回と同一のID-free view、ID-free Tool evidence、検証エラー、ID-free invalid outputだけを用い、通常Toolを無効にする。ConcernはRuntime検証されるTool経由だけで提案できる。（追加）
- FR-78：Memory Formationは固定batch内のEvent Experienceを入力として、LLMが`content`、`reason`、`kind`、`perspective`だけを持つ最大4件のMemory候補を出力する。Runtimeは候補の自然言語をqueryに固定batch内だけをHybrid Retrievalし、所有権、subject、種別規則、versioned score閾値を満たすEventを根拠として付与する。Memoryのsubjectsは解決済み根拠EventからRuntimeが導出する。根拠なし・候補不支持は正常なno-opとしてbatchを完了し、検索基盤障害・transaction競合だけをbatch再試行にする。（C-10, C-25、追加：意味づけと根拠選択を分離するため）
- FR-79：Memory ReconciliationはRuntimeが再活性化理由ごとにHybrid Retrievalとcluster化で候補を集約し、選んだanchor Memoryごとに小さなReflectorを起動する。Reflectorは暗黙に束縛されたanchorだけについて`keep`、`update`、`split`と本文・理由・種別を出力し、他のMemoryを直接指定しない。Runtimeはanchorの`occurredAt`と既存根拠Eventの最大`occurredAt`の後に発生した関連Eventだけを検索して根拠と時系列を検証し、同時刻または過去のEventでは更新しない。episodicはkeepのみ、semantic / common-groundは後続Eventによる確認・訂正だけ、self-related / self-changeは少なくとも2件の独立した根拠Eventを満たす場合だけ更新・統合・分割できる。（C-03, C-10, C-15、追加：LLMの対象指定をなくしつつ局所的な再統合を行うため）
- FR-80：ReflectionでLLMへ公開するread-only ToolはReflection専用とし、検索query、時間範囲、種別等の自然言語・非ID入力だけを受け取る。Tool結果からcanonical ID、局所参照、cursorその他の永続Record識別子を除き、Runtimeだけが非公開handleで検索結果・anchor・監査Recordを対応付ける。対象の詳細・履歴・ページングはRuntime束縛または自然言語queryで行い、LLMにRecord IDを再入力させない。（C-16, C-25、追加：Tool経由のID露出を防ぐため）
- FR-81：Reflectionの候補解決結果は`committed`、`no-op`、`deferred`、`retryable`、`conflict`に分類する。`deferred`は共有予算で未開始となった候補であり次Sessionへ残す。`no-op`は未支持・変更不要・解決不能な候補を監査して対象を完了し、`retryable`は検索基盤障害等の技術失敗だけを対象別backoffへ渡す。`conflict`は最新Stateを再読込して1回だけ再評価し、なお競合すればretryableとする。Formation cursorは完了batchだけを進める。Runtimeはresolver version、query要約、候補数、採用・却下根拠、score、時系列判定、最終分類を監査可能にする。軽量Reflector callはSession共有の設定可能な予算（既定32、上限96）、RAG query予算（既定256、上限999）、並列数（既定4）を持ち、候補が尽きた時点でも停止する。（C-20, C-25, C-27、追加：高コストな全件LLM走査を避け、失敗を再現可能に扱うため）

## R8. 永続化、配送、運用

- NFR-7：Event、Run、Assessment、Tool execution、State change、Memory、Receipt、Outbox、Concern Activity、Reflection Session / Reflector attempt / Memory batchを監査可能にする。`events`は不変の論理Event、`agent_runs`はretryを含む実行attemptとし、同じEventからEvent Experienceを重複形成しない。Event Experienceは意味表現の正、Event Projectionはembeddingと検索状態だけを持つ再生成可能な派生index、Tool ResultはRun監査であって通常のEvent projection・Reflection検索対象ではない。既存Concernの正規化は、実際に本文を変更したConcernだけへRuntime生成のrun ID・時刻を持つ`reviewed` Concern Activityを残す。（C-24, C-27、更新）
- NFR-8：Action、State Patch、Outboxを一つのDB transactionで確定する。G1/G2/ReflectionのMemoryIntentはmemory-update Eventのtransactionで確定する。G3結果に由来する長期経験は通常Agent Loop後のExperience Integration transactionで確定し、G3又はMainAgentの出力だけでは確定しない。検索対象のG3 EventもExperience Integration後にだけProjectionを形成する。schema変更はexpand → data migration → reader切替 → writer切替 → contract → dropで進め、data migrationはdry-runを既定、明示`--apply`時だけ書込み、未完了work item又は参照不整合があれば切替を中止する。既存Concern正規化もdry-runを既定とし、一件でもmodel / schema失敗があれば書き込まず、`--apply`時はState version、全変更、Concern Activityを一つのtransactionで確定する。（C-24, C-59, C-63、更新）
- NFR-9：Queue、Outbox、Tool実行はretryと重複実行に耐える。（C-20, C-27）
- NFR-10：Agent単位advisory lock、state version、Tool権限、TTL、hop、rate limitを通常コードで保証する。Discord reply chainのhop復元は各Bot process内の短期Mapだけを用い、永続化又はBot間共有を要求しない。（C-27, C-28、更新）
- NFR-11：PostgreSQL schemaは現行Domain契約だけを保持し、削除した旧互換tableや列を戻さない。通常CRUD、transaction、schema DDLはDrizzle ORMを標準とし、pgvector / hybrid ranking、lease claim、advisory lock、rate-window原子更新だけをrepository内に閉じたPostgreSQL固有SQLとして許容する。application service、Tool adapter、Debug UIは`Pool` / `PoolClient`を直接操作しない。（C-18、更新）
- NFR-12：Debug UIは観測用途に限定し、独自の書込み経路やAgent Loopを持たない。Eventごとに発火入力、Run開始時の判断入力断面、Tool実行、外部化済みの評価・Action、State / Memory更新、後続処理を追跡し、Event台帳に起点のない更新とReflectionを通常Event traceと区別して表示する。モデルの内部思考過程やprompt全文は保存・表示しない。（C-20, C-54）
- NFR-13：`.env`は実行時だけ読み込み、値をlog、test artifact、文書へ表示しない。（C-28）

## R9. 予測・予測誤差・背景経験

- FR-48：G1/G2はdirectな`message-received`への応答後に、同じ相手からの次ターンの発話を予測し、同じ解決済みsubjectからの次のdirect入力で誤差を1ターン遅れで評価する。peer/observedと自律Eventは予測対象にしない。保存済みPredictionに廃止済みroot fieldが残る場合は、既知のfieldだけを除去して現行契約として読む。（C-30, C-32, C-33, C-48）
- FR-49：G1/G2は1回のLLM callで、予測候補、predictionEvaluation、G3起動判断を返す。観測候補とrememberは返さず、長期経験の統合を担わない。（C-34, C-35, C-36, C-37, C-38、更新）
- FR-50：G1/G2はFeelingを出力せず、Meaning / FeelingはMainAgentだけが確定する。（C-65）
- FR-51：G3はMainAgentとは別のDeepAgentとして遅延実行し、仮説評価、発見、自然言語のMemory候補を通常Agent Loopへ渡す。G3自身はMemoryIntent又は永続Recordを直接指定しない。（C-39, C-40, C-42、更新）
- FR-52：G3結果のMainAgent再判断は通常Loopに通し、`prediction-g3-result` EventはAgent自身に共有する動機がある場合だけ発話する。`no-external-action`を成功として扱う。`prediction-g3`はActionを生成しない。（C-41、更新）
- FR-53：背景経験はConversation Memoryと別Storeに保持し、起動前の初期化時だけYAMLで置換し、プロセス起動中は変更しない。（C-43, C-45）
- FR-54：背景経験は、AIである自身と作成者if001のプロフィール、曖昧な段階、状況、複数ユーザーやif001との対話・探索、感じたこと、結果、学びを持ち、今回のユーザーとの共有経験を含めない。年齢、出身地、家族構成を持たない。（C-44, C-47）
- FR-55：Conversation Memoryと背景経験は、単一RetrievalServiceでvector、keyword、subject、recencyを共通順位付けにして検索する。（C-46, C-56）
- FR-56：MemoryIntentのtargetはMemory kindに限定し、RelationshipとConcernは既存PatchまたはConcern Proposalへ渡す。（C-66）
- FR-57：Conversation Memoryの書込みはMemoryWriteServiceだけが行い、RAG候補と種別規則からcreate、update、no-op、splitを決め、Memory versionを照合する。splitは元Memoryを狭い内容へ更新し、分離した内容を元Memoryへの根拠を持つ新規Memoryとして同一transactionで作る複合操作である。（C-55, C-57, C-58, C-63, C-67、追加：Reconciliationで意味を失わず分離するため）
- FR-58：G1/G2/ReflectionのMemoryIntentはmemory-update Eventで専用MemoryUpdateHandlerが適用し、LLMを呼ばない。Reflection Memory Reflectorは経験の解釈、理由、種別、視点、検索主体だけを出力する。根拠Event、関連Memory、更新対象はcommit層が固定Session範囲とHybrid Retrievalから解決し、confidenceとpurposeも導出する。G3結果は通常Agent Loop後のExperience Integrationがsource EventとRuntime evidenceから長期経験を統合し、G3又はMainAgentがMemoryIntentを直接指定しない。（C-59, C-60, C-63, C-66, C-69、更新）
- FR-59：Event優先順位は`message-received/human/direct`、`message-received/peer/direct`、`message-received/peer/observed`、memory-update、G3、reflectionの順とし、direct入力を待たせず、実行中の下位処理を強制中断しない。（C-61, C-69）
- FR-60：ReflectionはMemory、Self / Mood、Relationship、Concernごとのstatusを持ち、Memory確定後にConcern / Relationship、最後にSelf / Moodを更新する。Memory batchと失敗対象だけを再試行し、完了batchを重複確定しない。選択Contextと完全commit基準Stateは分離する。（C-64, C-68）
- FR-71：Memory Formationは、固定Reflection Session内の未統合Eventを古い順に最大16件ずつ扱い、各Eventから直接支持できる新しいConversation Memoryだけを形成する。初期入力へ既存Memory集合を含めず、保存不要なら空出力にする。Formationが既存Memoryとの重複を疑う場合だけ、限定された読み取りで確認する。古いEventを根拠に、内容一致だけで後から形成されたMemoryを更新または時系列的に巻き戻してはならない。（C-03, C-10, C-15、追加）
- FR-72：Memory Reconciliationは、全Memoryの定期全件走査をせず、新規Formationによる影響、利用・Concernの根拠、未再検討、遠い連想のいずれかを理由として選ばれたアンカーMemoryまたは局所クラスターだけを扱う。Runtimeはembedding近傍・subject・時刻で候補をcluster化し、理由間をround-robinして最新順だけに偏らない代表anchorを選ぶ。各anchorは関連Memory最大6件と関連Event最大16件までを取得できる。候補が尽きるかSession共有の軽量Reflector call予算に達するまで処理し、Reflectorは再活性化理由、参照した根拠、結果を監査する。（C-03, C-10, C-15、追加：全件走査を避けつつ再活性化の選択を検証可能にするため）
- FR-73：Reconciliationでは、episodic Memoryを内容更新しない。semantic / common-groundは後続経験による確認・訂正がある場合だけ更新し、矛盾は新旧の根拠と時刻を保持して整理する。self-related / self-changeは複数経験の反復を根拠に統合、弱化、更新または分割できる。単なる内容一致、古い根拠、または根拠なしで既存Memoryを上書きしない。（C-03, C-10, C-15、追加）
- FR-74：Conversation MemoryとBackground Experienceの既存Hybrid Retrievalは共通RetrievalServiceで継続する。Reconciliation用の関連Event検索は、Event IDによる直接参照とは別に、agent所有権、時刻、Event種別、subject、keyword、vectorを持つEvent projectionを検索対象とし、同じhybrid rankingの契約へ追加する。元Eventは監査の正本として保持し、projectionは検索専用の派生データとする。（C-10, C-20, C-27、追加）
- FR-75：Tool Resultは監査記録として保持するが、通常のEvent projection・embedding・Reflection検索の対象にしない。Experience Integrationはcommit済みのEvent、Action、Tool結果、State変更からEvent固有のsummaryとfactsを形成し、Memory FormationとEvent検索はこのEvent Experienceだけを根拠にする。固定trigger reason、Meaning、Feeling、未確認の推測だけからExperienceやMemoryを形成しない。Experience形成の失敗は親Eventのcommitを巻き戻さず、そのEventをMemory Formation対象から除外する。（C-10, C-16, C-22、追加）
- FR-61：memory-update EventはsourceEventIdとintentIndexで冪等にし、部分的なintentだけをcommitしない。（C-50, C-52）
- FR-62：predictionContextは前回予測、誤差評価、G3要約とmemoryIntents、RecentExperienceのeffect、memoryCandidatesを持つ。（C-51, C-62, C-66）
- FR-63：G1/G2の追加LLM callはNFRの例外とし、deadlineとcall予算を持つ。（C-70）
- FR-64：予測Loopは旧continuity / memory分割後処理ではなく、Memory書込みはMemoryWriteServiceに集約する。（C-70）
- FR-65：通常Ollamaの構造化出力はJSON Schemaのfield descriptionを`format`または`withStructuredOutput`で渡し、DeepAgentは`toolStrategy`のstructured output toolへ同じdescription付きJSON Schemaを渡す。descriptionはRuntime検証を置き換えない。（C-71）
- NFR-14：predictionContextと背景経験はAgent所有権とContext budgetの対象にする。（C-51）
- NFR-15：MemoryWriteServiceはAgent単位で直列化し、Memory versionの楽観ロックと冪等性を保証する。（C-67）
- NFR-16：G1/G2の追加callはdeadline、最大試行回数、call予算を持ち、失敗しても通常会話を継続する。（C-52, C-70）
- NFR-17：Prediction Evaluation、MemoryIntent、memory-update Event、Reflection Session / Reflector status、Concern Activityと決定論的closeを監査可能にし、再試行に耐える。（C-50, C-64, C-69）
- NFR-18：directな`message-received`が待っている間はmemory-update、G3、reflectionを開始しない。（C-61, C-69）
- NFR-19：背景経験のYAMLはSchema、段階と日時の順序、AI・作成者if001・経験範囲のプロフィール矛盾、現在のユーザーとの共有経験の不在、実在人物の特定可能性、タグ・感情・テーマ・段階の分布を検証する。起動前の初期化時だけ置換し、会話Memoryを上書きしない。（C-45, C-47）
- FR-86：Background Experience YAMLは`background:load <path>`で対象AgentのBackground Experience Storeへ単独で置換投入できる。YAMLのagentIdと対象を一致させ、会話Memory、Self、Stateを変更しない。Embedding設定が有効なら投入後にBackground ExperienceのEmbeddingを作成する。（C-45, C-46）
- FR-87：予測誤差に加え、自律EventのTool成功・失敗、探索で得た事実、進展のなさを、Self、Commitment、Concern、Relationship、Background Experienceに照らしてappraisalする。喜びだけでなく、驚き、失望、苛立ち、怒り、警戒などを正当なFeelingとして扱い、相手へ共有しやすい前向きな結論へ丸めない。持続する影響はMood、Concern、Relationship、次のActionへ反映する。（C-03, C-07, C-09, C-14, C-17, C-48）
- NFR-20：G1/G2、G3、MainAgentの構造化出力Schemaは主要fieldのdescriptionを保持し、通常OllamaとDeepAgentの両経路でdescription付きJSON Schemaをモデルへ渡す。descriptionの有無をtestで検証する。（C-71）

## 完了判定

- AC-1：自動testはschema、境界、失敗時の非commit、運用不変条件を判定する。（FR-13, FR-15, NFR-8, NFR-10）
- AC-2：実Ollama試験はモデルが応答・repairできることを確認する。（FR-14, FR-16）
- AC-3：隔離PostgreSQLを使うproduction-like E2EはUIに依存せずContext、Tool binding、commit、Outbox配送まで通ることを確認する。（FR-2, FR-4, NFR-8, NFR-9）
- AC-4：人格・状態差が行動差を生むという概念上の主張は、自動test合格だけでは完了としない。同一ObservationでSelf、Mood、Concern、Relationship、Memoryだけを変えた反復paired live evaluationと保存artifactで評価する。（C-03, C-13, C-14, C-29, C-53, FR-3, FR-41）
- AC-5：Event種別とinteractionに応じたTool公開と実行拒否を自動testで確認する。directな`message-received`ではself_getが公開され、concern_list、concern_get、concern_proposeは公開されず、直接呼ばれても実行されない。（FR-33, FR-90）
- AC-6：`previousDesire`の即時引き継ぎ、時間経過、満足済みDesire、Reflectionの新規Concern作成を自動testで確認する。（FR-43, FR-44）
- AC-7：idleのno-external-action拒否、再開間隔、夜間時間帯のidle Event抑制をUnit/Contract testで確認する。（FR-22, FR-45）
- AC-8：共通の社会基盤を満たしつつ、質問しない選択とDispositionによる個体差を許容することをUnit testで確認する。（FR-46）
- AC-9：Agent Coreの実効system promptは4,500文字以下を保つ。SkillsMiddlewareのskill catalogはモデルへ渡す前に除去する。（NFR-4）
- AC-10：Event種別とinteractionごとのskillが読み込まれ、`message-received`のhuman/direct、peer/direct、peer/observed、idle、concern-due、scheduled-taskのFlowに応じた指示へ到達することをUnit testで確認する。（FR-47, FR-90）
- AC-21：自律EventのpromptとConcern適用が、未返信を抑制根拠にせず、毎回の発話と独立Concernの並行保持を指示・実現することをUnit testで確認する。（FR-67）
- AC-22：idleが、ユーザー自身への関心を扱う場合にだけ必要なユーザー文脈を確認し、根拠付きの最大1件の問いを選べること、およびBackground Experienceを現在のユーザーとの共有経験として扱わないことをUnit testで確認する。（FR-70）
- AC-23：Background Experienceの単独投入がYAMLを検証し、対象Storeだけを置換して会話Memoryを保持することをIntegration testで確認する。（FR-86）
- AC-20：Agent Coreと自律skillが、予測誤差・Tool結果・探索結果からネガティブなFeelingと持続状態への反映を許可し、前向きな結論への丸めを禁止することをUnit testで確認する。（FR-87）
- AC-11：G1/G2の予測、1ターン遅れの誤差評価、Feelingを出力しないことをContract/System testで確認する。（FR-48, FR-49, FR-50）
- AC-12：MemoryIntentからcreate、update、no-opが決まり、Memory versionの競合と直接INSERTの不在をIntegration testで確認する。（FR-57, NFR-15）
- AC-13：memory-update EventがLLMを呼ばず、専用Handler、冪等性、部分commit禁止、directな`message-received`優先で動くことをSystem testで確認する。（FR-58, FR-59, FR-61, NFR-17, NFR-18）
- AC-14：背景経験が別Storeで不変であり、AI・作成者if001・段階のプロフィールを持ち、現在のユーザーとの共有経験を含まず、実在人物・分布の検証を通り、共通Retrievalで取得できることをIntegration testで確認する。（FR-53, FR-54, FR-55, NFR-19）
- AC-15：ReflectionがMemory、Self、Relationship、Concernごとのstatusを持ち、失敗対象だけを再試行することをSystem testで確認する。（FR-60, NFR-17）
- AC-16：G3が別DeepAgentとして遅延実行され、MainAgentの再判断が通常Loopを通り、G3 Eventが通知必須の例外になることをSystem testで確認する。（FR-51, FR-52）
- AC-17：MemoryIntentのtargetにRelationshipとConcernが含まれず、既存PatchまたはConcern Proposalへ渡ることをContract testで確認する。（FR-56）
- AC-18：predictionContextの所有権とContext budget、予測Loopが旧後処理ではないこと、G1/G2のcall予算をContract/System testで確認する。（FR-62, FR-63, FR-64, NFR-14, NFR-16）
- AC-19：通常OllamaとDeepAgentの構造化出力がdescription付きJSON Schemaを渡し、G1/G2、G3、MainAgentの主要fieldにdescriptionがあることをContract testで確認する。（FR-65, NFR-20）

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
| memory-update、G3、reflectionがdirectな`message-received`を待たせない。 | FR-59, NFR-18, AC-13 |
| 旧continuity / memory分割後処理を戻さない。 | FR-5, FR-64, AC-18 |
