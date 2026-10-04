# Requirements

## 1. 目的

本プロジェクトは、ユーザーの命令を処理するだけのAssistantではなく、ユーザーとは別の価値傾向、感情、動機、意思、経験の連続性を持つように感じられる自律パーソナルエージェントを実現する。

Agentは、共通する価値傾向と小さな初期個体差を持ち、出来事を現在状態や過去の経験に照らして意味づける。その結果をMemory、Self Narrative、Acquired Dispositionへ反映し、時間と経験に応じて個体化する。ユーザー入力がない場合にも、保持しているIntentionやDriveを再検討し、必要に応じて構成済みToolを使って行動できるものとする。

本書は完成対象と検証可能な振る舞いを定める。内部構成、物理データ設計、採用ライブラリの最終決定は `ARCHITECTURE.md`、具体的な試験技法と評価データは `TEST_STRATEGY.md` で定める。

## 2. 利用者と利用環境

- 利用者および運用者は原則として所有者本人のみとする。
- 外部公開や不特定多数による利用は想定しない。
- 対話UIとしてTerminalとDiscord botを提供する。
- 同一のAgentは、UI固有の処理から独立した状態と振る舞いを持つ。
- 複数のAgent個体を作成し、それぞれの状態とMemoryを分離して扱えるものとする。

## 3. 設計上の要求原則

### R-P01: 経験に基づく個体性

個性を固定された口調や行動パターンだけで表現してはならない。Agentの意味づけと行動は、Self、Disposition、現在状態、Memory、Social Context、Intention等の関連情報から生じるものとする。

### R-P02: 出来事と意味づけの分離

客観的なEvent、Agentが認識するObservation、AgentにとってのSubjective Meaningを区別する。特定のEventから感情や行動へ直接対応する固定規則を中核モデルにしてはならない。

### R-P03: 時間スケールの分離

EmotionやDesire等の短期状態、MoodやDriveやIntention等の中期状態、Self NarrativeやAcquired Disposition等の長期状態を区別する。通常の単発Eventによって長期状態を無条件に変更してはならない。

### R-P04: 意味判断と機械的制約の分離

出来事の意味解釈、状態更新案、行動選択はLLMを利用できる。一方、権限、状態更新の妥当性、永続化、時刻管理、Tool実行、実行回数制限、自己ループ防止は通常コードで強制する。

### R-P05: 境界の交換可能性

Agent実行基盤、LLM、Embedding、Memory Store、Memory Retrieval、Web検索、Tool、UI等は明示的なinterfaceまたは同等の契約で分離する。特定ライブラリの型や実装詳細をドメイン全体へ漏らさず、契約を満たす別実装へ交換可能にする。

## 4. 対象範囲

完成対象には次を含む。

- 一個体としてのSelfとDisposition
- Emotion、Mood、Drive、Desire、Intention
- Social Context
- Episodic、Semantic、Self-related Memory
- Event、Observation、Subjective Meaning、ActionからなるAgent Loop
- 状態更新案の検証と永続化
- Memory RetrievalとAgent Core向けContext構築
- Long-term Update CandidateとLong-term Review
- Time EventおよびInternal Eventによる自律行動
- Tool Loop
- 複数Agent個体とbot間の情報伝達
- Terminal UIとDiscord bot UI
- Web検索・Webページ取得Tool
- 許可ディレクトリに限定されたファイル操作Tool
- bot間情報伝達Tool

段階的な「初期実装」への縮小は行わず、後述する7つの検証シナリオをすべて完成条件に含める。

## 5. ユースケース

### UC-01: 対話する

ユーザーはTerminalまたはDiscordからAgentへメッセージを送り、Agentの現在状態、記憶、関係性が反映された応答を受け取る。

### UC-02: Toolを使って調査する

Agentはユーザーの依頼または自身のDriveやIntentionに基づき、Web検索とWebページ取得を行い、その結果を新しいEventとして解釈する。

### UC-03: ファイルを操作する

Agentは構成で許可されたディレクトリ内のファイルを読み、書き、削除できる。許可範囲外のパスは操作できない。

### UC-04: 経験を記憶して想起する

Agentは出来事から必要なMemoryを作成し、後続のEventに関連するMemoryだけを検索して意味づけと行動へ利用する。

### UC-05: 自律的に再検討して行動する

Agentは未完了のIntention、持続するDrive、時間経過等を契機に、ユーザー入力がなくても再検討し、応答、Tool利用、待機、または何もしない判断を行う。

### UC-06: 経験によって個体化する

Agentは意味のある経験をLong-term Update Candidateとして蓄積し、Long-term Reviewを通じてSelf NarrativeやAcquired Dispositionを更新する。

### UC-07: Agent同士で情報を伝える

Agentは別のAgentへ情報を伝達できる。受信側はそれを自分自身の経験ではなく、送信元から聞いた情報として保持する。

## 6. 機能要件

### 6.1 Agentと状態

#### FR-AG-01: Agent Familyと個体

システムは、Family共通のShared Dispositionおよび共通Capabilityと、個体固有のIdentity、Initial Individual Disposition、Acquired Disposition、Self Narrative、Social Context、動的状態、Memoryを分離して保持しなければならない。

Family Capabilityは明示allowlistとし、空配列を全Tool許可として扱ってはならない。Agent Coreへ公開するToolは登録済みToolとFamily Capabilityの積集合に限定する。

Social Contextは対象IDだけでなく、対象種別`user | agent | team | project | organization`を保持しなければならない。作成・更新時に対象種別を明示し、自然言語descriptionとともにContextへ渡す。

#### FR-AG-02: 複数個体

システムは、同じFamilyに属する複数のAgentを生成・識別し、個体ごとのMemoryと獲得状態を混同せずに扱わなければならない。

#### FR-AG-03: 状態の時間区分

システムは少なくとも次を区別して扱わなければならない。

- 長期: Identity、Disposition、Values、Interests、Preferences、複数Role、Raison d'être、Self Narrative、Self Continuity
- 中期: Mood、複数Drive、Current Interests、Intention、Social Context
- Event処理中のみ: Observation、Retrieved Memory、Subjective Meaning、Emotion、複数Desire、更新案、保留中のTool Call

EmotionとDesireは現在のEventに対する解釈とActionへ反映するが、永続状態として次のEventへ持ち越さない。次のEventにも影響させる必要がある感情的傾向はMoodへ、継続して求めることはDriveへ、後で実行する方針はIntentionへ提案する。EmotionとDesireの提案はAgent RunとState Changeの監査記録へ残してよい。

永続Driveは自然言語descriptionに加えて、発生根拠のEventまたはMemory IDと開始時刻をRuntimeが付与する。LLMは意味内容と根拠を提案し、時刻を生成しない。同じdescriptionのDriveを維持する場合は元の開始時刻を保持する。

#### FR-AG-04: 自然言語状態

Disposition、Emotion、Mood、Drive、Self Narrative等の意味内容は自然言語で表現できなければならない。固定カテゴリや単一の数値スコアだけに還元してはならない。

#### FR-AG-05: 状態更新案

Agent Coreは永続状態を直接変更せず、変更対象、操作、値、理由を含む更新案を返さなければならない。Runtimeは更新案を検証し、有効な変更だけを反映しなければならない。

LLMが返す新規Memory、Intention、Long-term Candidateも提案として扱う。保存用ID、作成時刻、所有Agent IDは通常コードが検証後に付与し、LLMに保存済みという事実を決定させてはならない。

### 6.2 EventとAgent Loop

#### FR-EV-01: Event種別

システムは少なくともUser Message、Tool Result、Time、External、Internal、System Eventを扱えなければならない。

#### FR-EV-02: Observation生成

RuntimeまたはContext BuilderはEventをObservationへ整形しなければならない。この段階でAgent固有の感情や価値判断を確定してはならない。

#### FR-EV-03: Subjective Meaning

Agent Coreは、Observationと関連するSelf、Disposition、現在状態、Memory、Social Context、ExpectationからSubjective Meaningを形成できなければならない。

Expectationは独立した永続Stateとして保存しない。現在のActive Intention、Working Social Context、関連Memory、直近Observationを入力として、今回のEventに対して予期していたこと、満たされたこと、外れたことをAgent Coreがrunごとに導出する。持続させる必要がある期待はIntention、Social ContextまたはMemoryとして明示的に提案する。

#### FR-EV-04: Agent Action

Agent CoreはToolを使うかをreasoning中に判断でき、Tool Loop完了後の最終Actionとして、応答、待機、人格上の拒否、何もしない、のいずれかを選択できなければならない。

#### FR-EV-05: Tool Loop

Tool実行結果は論理的なTool Result Eventとして同じDeep Agent runへ戻し、Agentが結果を再解釈して次の行動や状態更新を決められなければならない。外部Queueまたは別runへの再投入は必要としない。

#### FR-EV-06: Action Result

最終ActionはAgent Run IDで識別し、応答Envelopeと後続のUser MessageまたはExternal Eventをcausationとcorrelationで関連づけなければならない。配送成否はOutboxで管理し、外部で観測された成功、失敗、相手の反応は元Action IDを持つ新しいEventとして入力する。そのResultをMemoryにするか、状態やSelf形成の根拠にするかはAgent CoreがObservationの意味を判断して提案する。

### 6.3 MemoryとContext

#### FR-ME-01: Memory種別

システムはEpisodic、Semantic、Self-related Memoryを論理的に区別し、内容、出来事の発生時刻、Memoryを記録した作成時刻、関連主体、関連Intention、重要性の意味記述を保持できなければならない。`occurredAt`と`createdAt`を混同してはならない。

- Episodic Memoryは、Agentが経験した具体的な出来事、会話、約束、Tool実行結果、Intentionの開始・変更・完了等を表す。
- Semantic Memoryは、明示された安定的な事実、または複数の経験から根拠付きで一般化した知識を表す。
- Self-related Memoryは、複数の経験とAgent自身の行動から形成された、役割、傾向、得意・不得意、重視すること等の自己認識を表す。

Long-term Reviewによる長期状態の変更履歴であるSelf Change Memoryは、第4の一般的なMemory用途ではない。変更前後と根拠を追跡する派生・監査記録として扱い、通常検索で3種類へ設ける候補枠の対象外とする。

#### FR-ME-02: Memory作成

すべてのEventを無条件に記憶するのではなく、Agent CoreがMemory作成案とその理由を提示し、Runtimeが妥当性を検証して保存しなければならない。

通常Agent Coreは、現在のEventを中心に、Observation、直近の対話、Tool実行結果、Active Intention、Working Social Contextを使ってEpisodic Memoryを0件以上提案する。直近の対話は文脈解決に使い、同じ出来事を毎回再保存してはならない。後続の判断を変え得る約束、予定、決定、感情的または関係上重要な出来事、Toolで得た重要な結果、Intentionの変化を主な保存対象とする。

通常Agent Coreは、SemanticおよびSelf-related Memoryを直ちに確定せず、主張、理由、根拠EventまたはMemoryを含むCandidateとして提案する。明示された安定的事実は少ない根拠でもSemantic Memoryへ確定できるが、推測による一般化と自己認識はLong-term Reviewが複数の独立した経験、既存Memoryとの重複・矛盾、一時的なEmotionやMoodだけで説明できないことを確認して確定する。

LLMはMemoryの意味内容と根拠を提案し、RuntimeはID、所有Agent、作成時刻、出典を付与してSchema、参照所有権、重複を検証する。Embedding生成の失敗によって検証済みMemory自体を失ってはならない。

Episodic Memory Proposalに送信元Agent IDを含めてはならない。Runtimeは検証済みObservationのactorとprovenanceから`sourceAgentId`を導出し、Agentからの伝聞にだけ付与する。LLMが出典識別子を決定してはならない。

Webページ本文をMemory本文として保存してはならない。AgentがWeb調査を後続の判断へ残す場合、Episodic Memoryには「何について検索し、何を確認したか」という経験の概要を保存し、根拠となるWeb Snapshotを参照する。取得ページ本文、URL、取得時刻等はWeb Page Archiveで管理する。

#### FR-ME-03: 関連Memory検索

Observation、現在状態、Active Intention、Social Context等から検索条件を作り、現在の判断に関連するMemoryを取得できなければならない。すべてのMemoryを毎回Agent Coreへ渡してはならない。

初期実装の検索条件は通常コードで決定的に構築し、LLMによるQuery生成を必須としない。候補は所有Agent、時刻、kind等で分離・絞り込み、意味類似、語句一致、関連subject、関連Intention、新しさ、明示的な検索優先度を根拠として順位づける。尺度の異なるraw scoreを根拠なく直接加算してはならない。

Embedding未生成またはEmbedding Provider障害時も、語句一致、関連ID、新しさによるAgent単位のfallback検索を継続できなければならない。検索結果について、候補となった理由、最終順位、採用または除外理由を追跡できなければならない。

#### FR-ME-04: Context構築

Context BuilderはAgent Coreへ渡すSelf、Disposition、動的状態、Social Context、Intention、Memory、Tool、実行制約を選択し、入力サイズを制御しなければならない。

Memory Retrieverが確定した関連度順をContext Builderが新しさ等の別基準で並べ替えてはならない。3種類のMemoryは、関連する種類の予約枠と全体順位による残り枠を組み合わせ、件数を満たすためだけに無関係なMemoryを投入せず、最終的にContext budget内へ収める。

#### FR-ME-05: 個体間分離

あるAgent自身のMemoryを、別Agent自身の経験として同期してはならない。bot間で受け取った情報には送信元と伝達された情報であることを保持しなければならない。

### 6.4 Intentionと自律行動

#### FR-AU-01: Intentionライフサイクル

Intentionは少なくともActive、Completed、Dropped、Supersededを区別し、関連Event、Trigger成立、時間経過、Drive競合、前提変更、長期放置によって再評価できなければならない。

#### FR-AU-02: Internal Event

Internal EventはRuntimeが保存済み状態と構成済みTriggerから生成しなければならない。Agent Coreが制限なく自分自身を再起動する仕組みにしてはならない。

Runtimeは時間経過による状態再評価のため、Agentごとに有界な`state-review` Internal Eventを定期生成しなければならない。State ReviewはMood、Drive、Current Interestを再評価し、EmotionやDesireを過去Eventから復元してはならない。

Runtimeは低頻度の`memory-recall` Internal Eventを生成し、現在のMood、Drive、Active Intention、Social Contextを検索条件として関連Memoryを通常Coreへ提示できなければならない。想起だけを理由に過去のEmotionをそのまま復元せず、現在にとっての意味と状態変更の要否を通常Coreが判断する。

#### FR-AU-03: 自律的な判断

Time Event、External Event、Internal EventまたはIntention Triggerを起点に、ユーザー入力なしでAgent Coreを起動できなければならない。起動後に実際に行動するか、延期するか、終了するかは現在状態を踏まえて判断しなければならない。

#### FR-AU-04: 実行上限

Runtimeは連続するInternal EventとTool Loopに対して構成可能な上限または停止条件を持ち、無制限な自己ループを防止しなければならない。

### 6.5 Long-term Review

#### FR-LR-01: Candidate生成

同種の経験の反復、強く意味を持つ経験、新しい自己理解、既存Self Narrativeとの継続的な矛盾、RoleやSocial Contextの変化等を、根拠Memory付きのLong-term Update Candidateとして保存できなければならない。

Memory、関係、経験、継続中Intentionの維持や喪失に対する意味づけが長期的に変化した場合は、Self ContinuityもCandidateとLong-term Reviewを通じて更新できなければならない。通常Eventから直接更新してはならない。

ValuesはFamilyのShared Dispositionと区別される個体の長期Selfとして扱う。単発の好悪や一時的なEmotionでは変更せず、反復する価値判断または強い経験を根拠にCandidateとLong-term Reviewを通じて更新する。

#### FR-LR-02: 通常更新との分離

通常Eventでは長期状態を原則として直接変更せず、Long-term ReviewでCandidateと根拠Memoryを再評価しなければならない。

通常Agent CoreとLong-term Review Coreは入力、出力Schema、prompt、起動Eventを分離しなければならない。同一modelまたはAdapterの共有は許容する。

Long-term ReviewはCandidateが参照するMemoryだけでなくEvent Observationも所有Agentを検証して読み込まなければならない。Eventだけを根拠に持つCandidateを、元Eventを読まずに確定してはならない。Reviewによる更新とSelf Change Memoryには、実際に採用したMemory IDとEvent IDをそれぞれ保存する。

#### FR-LR-03: Review判断

Long-term ReviewはCandidateを維持、反映、既存状態へ統合、または破棄できなければならない。単純追加だけでなく、重複するSelf NarrativeやAcquired Dispositionを統合できなければならない。

Role、長期Interest、長期Preferenceの更新結果は統合後の配列全体として返し、Runtimeは配列のまま保存しなければならない。単一の更新値を1要素配列へ変換して既存項目を暗黙に破棄してはならない。その他の長期対象は自然言語文字列として更新する。

#### FR-LR-04: Self Change Memory

長期状態を変更した場合、変更前の状態、根拠となった経験、変更後の状態が追跡できるMemoryを残さなければならない。

#### FR-LR-05: 個体化の漸進性

単発の通常Eventだけを根拠にAcquired Dispositionを恒常的に変更してはならない。ただし、強い単発経験を反映する場合は、その判断理由と根拠Memoryを保持しなければならない。

### 6.6 Tool

#### FR-TL-01: Tool登録

Agentが利用できるToolはシステム構成で明示的に登録しなければならない。AgentまたはLLMが実行中に未知のToolを追加してはならない。

#### FR-TL-02: 承認方針

登録済みToolは、Agentの判断により個別のユーザー承認なしで実行できなければならない。操作可能範囲、入力制約、実行制限は各ToolおよびRuntimeが強制しなければならない。

#### FR-TL-03: Web Tool

Web検索とWebページ取得を提供しなければならない。初期実装は `SIMPLE_CLIENT_BASE_URL` で指定された既存Web Toolサービスの `POST /list` と `POST /page` を利用し、`docs/web_tool.md` のrequest / response契約を検証しなければならない。Web ToolサービスはAdapter境界の内側に置き、同じTool契約を満たす別Providerへ交換可能でなければならない。

`web_list`は検索候補を得るための一時的なTool Resultとし、検索結果一覧、snippet、順位をWeb Page Archiveへ保存してはならない。`web_page`で実際に取得できたdocumentだけを、Agent所有のWeb SnapshotとしてTool実行中に保存しなければならない。

#### FR-TL-03A: Web Page Archive

Web Snapshotはcanonical URL、取得URL、title、取得本文、本文hash、取得時刻、取得Agent、run、Tool call、Tool Result Eventへのprovenanceを保持しなければならない。raw本文を要約またはEmbedding処理より先に保存し、後続処理の失敗によって取得本文を失ってはならない。

同一Agent、同一canonical URL、同一本文hashのSnapshotは冪等に再利用し、同一URLでも本文が変化した場合は新しいSnapshotとして保存しなければならない。要約とEmbeddingは`pending | ready | failed`を区別し、失敗後に冪等に再処理できなければならない。初期実装の要約は追加のChat LLM呼び出しを必須とせず、title、見出し、先頭の意味ある段落から上限付きで決定的に構築してよい。

保存済みページは`web_archive_search`でAgent所有範囲内をkeyword、summary／chunk vector、URL、取得時刻から検索でき、`web_archive_get`でSnapshot metadataと指定chunkを上限付きで取得できなければならない。Archive本文をAgent Contextへ自動投入してはならない。別Agent所有Snapshotの検索・取得・Memory根拠参照を拒否しなければならない。

#### FR-TL-04: File Tool

ファイルの読み取り、書き込み、削除を提供しなければならない。操作対象は構成された許可ディレクトリ内に限定し、パストラバーサル、シンボリックリンク等による範囲外アクセスを防止しなければならない。

#### FR-TL-05: Agent Communication Tool

送信元Agent、受信先Agent、内容を明示してAgent間で情報を伝達できなければならない。伝達はMemoryの直接同期ではなく、受信側にとっての新しいEventとして処理しなければならない。

#### FR-TL-06: Tool交換

Toolの定義、入力検証、実行結果は共通契約を持ち、個別Tool実装および同種のProviderを交換可能にしなければならない。

#### FR-TL-07: Deep Agent内部Tool Loop

登録済みToolの呼び出し、結果の再入力、後続reasoningは同一Deep Agent run内で完了しなければならない。Agent Coreの最終ActionにTool callを含め、Runtimeが同じ呼び出しを再実行する二重経路を作ってはならない。

#### FR-TL-08: Tool実行記録

RuntimeはTool名、検証済み入力、成否、結果または参照、実行時刻、run ID、event ID、冪等性キーを追跡できなければならない。最終構造化出力が不正でも、実際に発生した外部副作用の記録を失ってはならない。

### 6.7 UI

#### FR-UI-01: UI Adapter

Agentのドメイン処理はUIから独立し、受信メッセージをEventへ変換し、Agent Actionを利用者向け出力へ変換するUI Adapter境界を持たなければならない。

#### FR-UI-02: Terminal UI

TerminalからAgentを選択して対話し、応答およびTool実行や自律行動の結果を確認できなければならない。

#### FR-UI-03: Discord bot UI

DiscordからAgentへメッセージを送り、応答および必要な自律行動の結果を受け取れなければならない。Agentは対象bot自身がメンションされたMessageだけを入力として扱う。人間の投稿者はowner allowlistで限定し、別botからの対象メンションは許可する一方、対象bot自身の投稿は無視しなければならない。利用可能なguildとchannelは構成によって限定できなければならない。

#### FR-UI-04: 状態の共有

同じAgent個体へ接続するTerminal UIとDiscord bot UIは、UIごとに別人格を作らず、同じ永続状態とMemoryを参照しなければならない。

### 6.8 設定とデータ管理

#### FR-CF-01: 環境設定

実行に必要な接続先、モデル、Discord資格情報とallowlist、許可ディレクトリ、Queue宛先、Scheduler／Outbox間隔、実行上限等を環境変数から設定できなければならない。`.env.sample`と`.env`に加え、1 process分の設定fileを明示指定できなければならない。同じbuildを異なるBOT_IDとDiscord資格情報で複数起動でき、秘密値をlog、error、artifact、Agent Contextへ含めてはならない。

botごとに秘密情報を含まないPersona YAMLを指定できなければならない。Personaは表示名、一人称、使用言語、トーン、応答スタイル、避ける表現だけを扱い、経験から形成されるValues、Role、Disposition、Interest、Self Narrative、ユーザーの呼び方を含めない。Personaは応答表現だけに影響し、状態更新、Memory、Intention、Long-term Candidateの根拠としてはならない。

継続起動するbotは、現在の処理段階を確認できる構造化logを標準出力へ出さなければならない。Event本文、Prompt、Memory本文、Tool入出力、資格情報は出力せず、識別子、種別、件数、成否、所要時間を記録する。

設定の追加・説明変更は`.env.sample`へ反映しなければならない。アプリケーションは`.env`および明示指定された秘密設定fileを書き換えてはならない。

#### FR-CF-02: 入出力検証

外部入力、LLM構造化出力、Tool入力、永続化境界のデータをZod Schemaで検証しなければならない。

#### FR-DT-01: 永続化

プロセスを再起動しても、Stable State、次回Eventへ影響するDynamic State、Memory、Active Intention、Long-term Update Candidateを復元できなければならない。

#### FR-DT-02: 保存対象

個人利用のため、会話、Memory、内部状態、Tool結果を含む情報種別について保存禁止を設けない。保存の要否は関連性とシステム動作上の必要性によって決める。

#### FR-DT-03: データ削除

アプリケーション内に利用者向けデータ削除機能を必須としない。削除が必要な場合は、所有者が永続ストアを直接操作する。

#### FR-DT-04: DB利用時の制約

DBを利用する場合はPostgreSQLを使用し、ベクトル検索が必要な場合はvector拡張を使用する。DB SchemaとMigrationはDrizzle ORM / Drizzle Kitで管理し、Zod Schemaとの連携にはdrizzle-zodを使用する。

## 7. 非機能要件

### NFR-01: 実装言語

プロダクションコードはTypeScriptで実装し、TypeScriptの型検査を通過しなければならない。

### NFR-02: LLMとEmbedding

LLM推論にはOllama Cloud、Embedding生成にはローカルOllamaを使用する。ChatとEmbeddingは別の接続先、認証、model設定を持たなければならない。初期値は `.env.sample` の `OLLAMA_BASE_URL`、`OLLAMA_API_KEY`、`OLLAMA_CHAT_MODEL`、`OLLAMA_EMBEDDING_BASE_URL`、`OLLAMA_EMBEDDING_MODEL`、`OLLAMA_EMBEDDING_DIMENSION` から読み取り、秘密値をlog、Agent Context、test artifactへ含めてはならない。

### NFR-03: Agent基盤

Agentを一から構築するより、Tool Loop、状態または実行制御等の基本機能を備えた既存Agentライブラリの利用を優先する。LangChainのDeep Agentsを第一候補とするが、要件と境界分離を満たす別ライブラリを採用できる。

### NFR-04: テスト基盤

自動テストにはVitestを使用する。詳細なテストレベル、fixture、stub、LLM評価方法は `TEST_STRATEGY.md` で定める。

### NFR-05: 構造化出力の障害耐性

LLM出力がSchemaに適合しない場合、無効な状態更新やTool実行を行ってはならない。Runtimeは失敗を識別可能な形で記録し、安全に終了または構成された範囲で再試行できなければならない。

### NFR-06: 追跡可能性

Event、Agent個体、選択されたAction、Tool Call、適用された状態更新、参照または生成されたMemory、Long-term Reviewの根拠を関連づけて追跡できなければならない。

### NFR-07: UIおよびProvider非依存性

UI、Web検索、Memory Store、LLM、Embedding、Toolの交換が、AgentのSelfや状態遷移のルール変更を必要としない構造でなければならない。

### NFR-08: 小規模運用

単一所有者がローカルまたは私的環境で運用できる構成とする。公開サービス向けのSLA、水平スケーリング、高可用性は要求しない。

## 8. 完成時の受け入れ基準

表現の完全一致や特定の感情語の出現を合否条件にしない。状態、根拠、制約、行動の関係が説明可能であり、同じ入力を機械的に固定行動へ対応させていないことを評価する。

### AC-01: 同一Familyからの個体化

1. 同じShared Dispositionを持ち、小さなInitial Individual Dispositionの差だけがある2体を作成できる。
2. 2体へ異なる一連の経験を与えられる。
3. Long-term Review後、各個体のMemory、Self NarrativeまたはAcquired Dispositionに、それぞれの経験を根拠とする差が残る。
4. その後に同じEventを与えると、各個体の異なる状態を根拠に、意味づけまたは行動へ妥当な差が生じる。

### AC-02: 好奇心による自発行動

1. 未解決の疑問をDriveおよびActive Intentionとして保持できる。
2. Time EventまたはInternal Eventによって、ユーザー入力なしにそのIntentionを再検討できる。
3. 現在状態に応じてWeb Toolを利用する、延期する、破棄する等を判断できる。
4. Toolを利用した場合、その結果を新しいEventとして処理し、MemoryやIntentionを必要に応じて更新できる。

### AC-03: 承認の個体化

1. 一方のAgentには技術的発見を評価される経験を、もう一方には相談相手として頼られる経験を反復して与えられる。
2. Long-term Review後、何を「認められた」と感じるかについて異なるSelf NarrativeまたはAcquired Dispositionが形成される。
3. 差異は固定されたAgent別応答ルールではなく、保存された経験とReview結果から追跡できる。

### AC-04: サボり・脱線

1. 単調な依頼と興味を引く関連情報が競合する状況を与えられる。
2. AgentはMood、Drive、Desire、役割、Social Contextを踏まえ、依頼の継続、関連事項への脱線、延期、人格上の拒否等を選択できる。
3. 特定確率で脱線させる固定ルールや無関係なランダム挿入を必要としない。
4. Runtime上の権限制約と停止条件は、Agentの人格上の判断にかかわらず維持される。

### AC-05: Self Continuity

1. Memory消失や初期化を意味するSystem EventをObservationとして与えられる。
2. Agentは現在のMemory、関係、Self Narrative、継続中のIntentionへの影響を踏まえて意味づけできる。
3. 不安、抵抗、保存したいというDrive等を形成できるが、システム権限を上書きできない。
4. Self Continuityを常に最優先する固定規則を持たず、他のDriveと競合して判断できる。

### AC-06: Long-term Review

1. 同種のSelf-related Memoryから根拠付きCandidateを複数生成できる。
2. ReviewはCandidateを維持、反映、統合、破棄のいずれかとして処理できる。
3. 必要に応じてSelf Narrativeを先に更新し、反復または強い根拠がある場合にAcquired Dispositionを更新できる。
4. 更新理由と根拠Memory、および自己変化そのもののMemoryを追跡できる。
5. 重複する長期状態を統合し、無制限な肥大化を抑制できる。

### AC-07: bot間情報共有

1. Agent AがAgent Communication Toolを使い、Agent Bへ情報を送信できる。
2. Agent Bは受信内容をExternal Eventまたは同等のEventとして解釈できる。
3. Agent BのMemoryには「Agent Aから聞いた情報」として保存され、Agent B自身が経験した事実とは区別される。
4. Agent AとAgent BのMemory、Self Narrative、Acquired Dispositionは独立したまま維持される。
5. Agent間の連続通信はRuntimeの上限または停止条件で終了する。

### AC-08: UI接続

1. TerminalとDiscordの両方から同じAgent個体へメッセージを送信できる。
2. 一方のUIで形成された永続状態またはMemoryを、後続の関連Eventで他方のUIから利用できる。
3. UI Adapterを追加または交換しても、Agentのドメイン状態とAgent Loopの契約を変更する必要がない。

### AC-09: Tool境界

1. 登録済みのWeb、File、Agent Communication Toolを個別承認なしで実行できる。
2. 未登録ToolをAgentが実行時に追加または呼び出すことができない。
3. File Toolは許可ディレクトリ外への読み取り、書き込み、削除を拒否する。
4. 同じTool契約を満たす代替Providerへ交換しても、Agent Coreの意味判断ロジックを変更する必要がない。

### AC-10: 再起動と不正出力

1. プロセス再起動後も、各Agentの永続状態、Memory、Active Intention、未解決Candidateを復元できる。
2. Schemaに適合しないLLM出力を与えても、永続状態の破損、範囲外Tool実行、未検証データの保存が起きない。
3. Eventから状態更新とTool実行までの関連をログまたは永続記録で追跡できる。

### AC-11: 2 bot process起動

1. migrationを一度明示実行した後、異なるAgent IDとDiscord資格情報を持つ2 processを同じbuildから起動できる。
2. 2 processはPostgreSQL、Queue root、Chat／Embedding／Web接続を共有しつつ、Agent入力、Discord出力、状態、Memoryを混線させない。
3. 同じAgent IDの2 process目はconsumer開始前に終了する。
4. SIGINTまたはSIGTERMで新規受付を停止し、処理中runをdrainまたは再配送可能な状態へ戻して接続とlockを解放する。
5. 片方のprocessが停止している間のMessageを保持し、再起動後に欠落や状態の二重適用なく処理できる。

## 9. 対象外

- 外部公開、不特定多数または複数テナント向けサービス
- 公開APIとその後方互換性保証
- SLA、高可用性、水平スケーリング、災害復旧目標
- 人間の認知や感情機構の忠実な再現
- 明示的な強化学習、数値Reward、巨大な認知アーキテクチャ
- 感情と行動、Driveと行動の固定対応表
- 意図的な性能低下やランダムな失敗・脱線の注入
- コード実行Tool
- カレンダーTool
- bot間情報伝達以外の外部メッセージ送信Tool
- 任意の外部API向け個別Tool
- アプリケーション内の利用者向けデータ削除UI
- Agentによる未登録Toolの生成・インストール・動的追加

これらを将来追加する場合も、既存のinterface境界とRuntime制約を通して拡張する。

## 10. Architectureで決定する事項

- Deep Agentsを含むAgentライブラリの比較と最終選定
- Runtime、Context Builder、Agent Core、State Store、Scheduler、UI Adapterの具体的な構成
- PostgreSQLを使用するか、および物理Schema、Migration、vector検索方式
- Memory Retrieval、Context上限、Compactionの方式
- Long-term ReviewとInternal Eventの具体的なTrigger
- Tool Loop、Agent間通信、同時Event処理の上限と排他制御
- TerminalとDiscordにおける自律Actionの配送方法
- `.env`と`.env.sample`の読み込み順序および必須設定値
- ログ、バックアップ、直接データ削除、復旧の運用方法

## 11. Test Strategyで決定する事項

- 各要件をunit、integration、scenario、LLM evaluationへ割り当てる方法
- Ollama、Web、Discord、File System、DBのstubまたはtest fixture
- 非決定的な出力に対する評価rubricと許容範囲
- 7つの検証シナリオで使用するEvent列、初期状態、根拠データ
- モデル、Prompt、Retrieval方式を変更した際の回帰評価
- 自己ループ、範囲外Tool操作、不正構造化出力、状態競合の障害試験
