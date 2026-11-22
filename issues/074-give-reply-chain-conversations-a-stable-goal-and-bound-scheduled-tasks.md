---
created_at: 2026-11-23
status: done
type: change
plan: []
requirements: [FR-21, FR-40, FR-76, FR-88, FR-90, FR-92, FR-94, NFR-8, NFR-17]
ui: []
requires: agent
---

# 074 Reply chainの会話Goalを保持しScheduled Taskを明示的な将来依頼へ限定する

起点：直近のshiro / akaの会話では挨拶の反復は減った一方、各EventのDesireが直前発話から作り直され、当初の目的が細かな手順・表現・予定へ置き換わっていた。ユーザーとの会話とBot間会話を別の認知pipelineにせず、通常投稿へのreplyから始まりreplyが続く単位をConversationとして扱い、そのAgent自身の安定したGoalを持たせる。また、会話の細かな次行為をScheduled Taskへ分解せず、Scheduled Taskは主として人から明示された将来・定期依頼に使う。

## Background

現行の`message-received`はhuman / peerで同じAgent Coreを通るが、会話目的はEventごとのDesireにしか存在しない。Discord reply chainをRuntimeが因果的に追跡しても、次Eventで当初の目的、進捗、未解決点を安定して再提示するConversation単位がない。このため、結論を変えない細部、文言調整、礼儀、実験手順の枝分かれが新しいDesireとなり、会話が目的を失ったまま続き得る。

会話は次の共通モデルへ変更する。

- human / peerを区別した会話機構を作らず、通常投稿へのAgentのreplyでConversationを開始する。
- そのreplyへの返信は同じConversationを継続する。mentionは開始契機になり得るが、継続を表す正本にしない。
- ConversationにはAgentごとの安定したGoalを一つ持たせる。同じDiscord reply chainでも各AgentのGoalは共有状態ではなく、そのAgentがなぜ会話するかを表す。
- Goalは複数Eventをまたぐ会話目的、Desireは今回のEventでGoalをどう進めたいか、Concernは会話外にも残る関心とする。
- 最新発話が結論、判断、必要な問い、反論、新事実又は次行為を実質的に変えない場合は、言い換え・追加の細部・礼儀だけで返信を続けない。
- Goalが達成、放棄又は現時点で行為へ移る状態になれば`no-external-action`で会話を閉じる。会話の外にも残る関心だけを既存Concern lifecycleへ委ねる。

Scheduled Taskは、原則として人から「あとで調べて」「明日教えて」「定期的に確認して」のように明示された将来又は定期実行依頼を受けた場合に作成する。Agent自身の関心、会話上の次の一手、実験手順、文言調整は、通常のDesire、Concern、`reconsiderAt`、idleで扱う。Agent自身のTask作成は、特定時刻でなければ成立しない観測、時間差比較、又はAgentが外部へ明示的に約束した履行などの例外に限定する。

## Dependencies

- #061 done
- #062 done
- #068 done
- #069 done
- #070 done
- FR-92の単一recipient Action変更がmainへ反映済みであること

## Scope

### Design checkpoint

- 実装前にConversationの正本、開始・継続・終了、Goalの作成・更新・不変部分、再起動時の扱い、Discord reply metadataとの対応、複数Agentが同じreply chainへ参加する場合の所有境界を設計する。
- GoalをLLMの自由な要約だけで毎回置換せず、初回の具体的目的を保持する。進捗と未解決点はConversationへ重複保存せず、Event、Desire、Memoryから必要時に導出する。
- Conversation stateをDBへ永続化するか、Runtimeの短期Mapで十分かを、返信間隔、再起動、監査、期限切れ、データ量から比較する。意味的正本を重複させず、Conversation、Memory、Concern、Scheduled Taskの境界を定める。
- GoalをAgent Coreの構造化出力へ追加するか、初回DesireとRuntime情報から別の軽量判定で形成・更新するかを、schemaの複雑さとcall数を含めて決める。
- 自然言語であるGoalの形成・達成・放棄・実質的差分はLLMに判断させ、reply chainの同一性、actor、時刻、turn数、所有権はRuntimeが機械的に判定する。時間経過だけによるexpiryは設けない。
- 上記にコンセプト、要件又は詳細設計の不足が見つかった場合は、既存実装に合わせて推測実装しない。選択肢と影響を整理し、既存の承認方針から一意に決められない重要事項だけユーザーへ確認する。

### Documentation and implementation

- `spec/`、要件、Architecture、Event overview、Motivation ModelへConversation GoalとScheduled Task境界を反映する。Motivation Modelは関係図の把握に必要な差分だけを簡潔に記載する。
- 通常投稿へのAgent replyをConversation開始としてRuntimeが記録し、そのreplyへのhuman / allowlist peer replyを同じConversationとして解決する。human / peerで別のConversation型又はAgent Coreを作らない。
- Agent Coreへ永続ID、Discord ID、local handleを渡さず、相手、Goal、進捗、未解決点、終了可能性を自然言語の小さいviewとして渡す。
- Conversation継続EventではGoalを今回のDesireと区別し、最新発話がGoalを実質的に進める場合だけ返信する。Goal達成後の同意、感謝、礼儀、言い換え、細部追加は`no-external-action`で閉じる。
- 会話中に実行すべき具体的な行為が確定した場合、会話で手順を細分化し続けず、現在実行できるならTool / Actionへ移る。将来時刻が不要ならScheduled Taskを作成しない。
- `schedule_task`と更新Toolのdescription、Scheduled Task skill、social-message skill、最小system prompt、schema descriptionを境界に合わせる。毎回のsystem promptを肥大化させず、Eventに対応するskillへ詳細を置く。
- Runtimeで可能なら、Scheduled Task作成をhumanから明示された将来依頼、又は説明可能なAgent自己予約例外へ結び付けて監査する。単語一致や特定文言による許可判定は行わない。
- Debug UI又は既存監査queryで、ConversationのGoal、状態、開始・継続・終了、対応Eventと、Scheduled Task作成理由が確認できるようにする。UI追加が過大なら、まず監査Recordのread-back testを正とする。
- schema変更が必要な場合はDrizzle schemaを正として`pnpm db:generate`でmigrationを生成し、SQL migrationを手書きしない。既存Conversationの移行は不要で、新規発生分から表示・追跡できればよい。

## Out of scope

- human用とpeer用に別々のConversation、Concern、Memory又はAgent Coreを作ること
- 共有された一つのConversation Goalを複数Agentの心理状態として扱うこと
- 会話内容を全てConversation tableへ複製し、Event / Experience / Memoryの正本を置き換えること
- Goal外の話題を自動的にすべてConcern又はScheduled Taskへ変換すること
- 特定語、正規表現、単純な文字列一致だけで、将来依頼、Goal達成又は終話を判定すること
- Agent自身によるScheduled Task作成を完全に禁止すること
- 過去のDiscord会話を遡ってConversationへ移行すること

## Implementation notes

- Conversationは社会的なreply chainの状態であり、長期人格状態のConcern、具体的経験のMemory、実行予約のScheduled Taskとは別責務にする。
- 推奨する最小state候補は、所有`agentId`、transport上のroot / latest message参照、自然言語Goal、短いprogress / unresolved、`active | completed | abandoned`、turn count、開始・更新・終了時刻である。最終fieldはDesign checkpointで正規化と監査用途を確認して決める。
- LLMが永続IDを生成・選択しない既存方針を維持する。Runtimeがreply metadataからConversationを解決し、モデルには自然言語viewだけを渡す。
- Goalは「相手に返答する」「会話を続ける」ではなく、確かめたいこと、伝えたい差分、反論、依頼、遊び、関係上の具体的目的を表す。単なる礼儀又は協力姿勢をGoalにしない。
- Scheduled TaskのAgent自己予約例外には、特定時刻にしか観測できない対象、時間経過そのものを比較する実験、Agentが明示的に引き受けた将来履行が含まれ得る。単に「後で続きを考えたい」はConcern / idleの対象とする。
- Scheduled Task toolをhuman/directでしか公開しないという単純制限は採らない。自律例外を残しつつ、意味判断をskill / descriptionと構造化された作成理由で支える。
- Conversation終了はEventやExperienceを削除しない。終了後に同じ相手から独立した通常投稿が来た場合は、新しいObservation Gate又は新しいConversationとして扱う。
- RuntimeがGoal達成又は現時点で継続理由なしと判断した終了は`completed`、AgentがGoal自体を放棄した終了は`abandoned`として扱える。現実装は`no-external-action`による通常終了を`completed`へ写像し、`abandoned`の生成は将来の明示的放棄理由へ予約する。
- Design checkpointの結論として、Conversation正本はAgent所有の`goal`、`status`、開始・最終Event、終了理由・時刻だけを保持する。各turnの進捗・未解決点はEvent、Desire、Memoryから導出し、Conversationへ重複保存しない。turn数はmessage対応から導出する。時間だけでは会話を失効させず、Agent CoreがGoal達成・放棄を自然言語で判断した`no-external-action`をRuntimeが機械的にcloseする。
- Discord message対応はDBへ永続化する。Conversation開始前の自律的な通常発話も外部message IDとcorrelationを保存し、再起動後の初回replyをdirectとして復元できる。Conversation内部キーはAgent IDで名前空間化し、同じreply chainへ複数Agentが参加してもGoalを共有しない。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | 追加 | reply chainを単位にAgent所有の安定したConversation Goalを持ち、Desire / Concernと分離する | `spec/personal-agent-concept-design-restructured-v2.md`, `docs/REQUIREMENTS.md` |
| MODIFIED | C-08 / FR-40 | Scheduled Taskを主として人から明示された将来・定期依頼へ限定し、Agent自己予約を時刻必須の例外とする | `spec/personal-agent-concept-design-restructured-v2.md`, `docs/REQUIREMENTS.md` |
| MODIFIED | FR-21 / FR-76 / FR-90 | human / peer共通のConversation Goal、reply継続、Goal達成時の非応答終了を定義する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-88 / FR-92 | mentionではなくDiscord reply metadataをConversation継続の正本とし、単一Action / 単一配送を維持する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-21 / ADR-24 | ConversationのRuntime所有境界、model-facing view、配送とreply解決を定義する | `docs/ARCHITECTURE.md` |
| MODIFIED | NFR-8 / NFR-17 | Agent所有・監査・再試行・重複防止をConversation stateにも適用する | `docs/REQUIREMENTS.md` |

## 影響範囲

検索した語：`message-received`、`peer/direct`、`peer/observed`、`Desire`、`会話目的`、`no-external-action`、`referencedMessageId`、`correlationId`、`respond.recipient`、`schedule_task`、`scheduled_task_update`、`Scheduled Task`

| 場所 | 内容 | 対応 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | Desire / Concern、Scheduled Task、自律性、Action | Conversation Goal追加とC-08境界を反映する |
| `spec/personal-agent-implementation-design-v2.md` | Context、Agent Core、Runtime、永続状態 | Conversation stateとmodel-facing viewを反映する |
| `docs/REQUIREMENTS.md` | FR-21、FR-40、FR-76、FR-88、FR-90、FR-92、NFR-8、NFR-17 | 更新する |
| `docs/ARCHITECTURE.md` | ADR-21、ADR-24 | 更新又は新ADRを追加する |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 通常会話フロー | reply開始・Goal・継続・終了を簡潔に追記する |
| `docs/AGENT_MOTIVATION_MODEL.md` | Desire / Concern / Conversationの関係図 | 重複文を増やさず図と短い境界説明だけ更新する |
| `docs/TEST_STRATEGY.md` | social Event、Scheduled Task | 新要件・変更要件のtest対応を追加する |
| `src/infrastructure/ui/discord-adapter.ts` | reply metadata、短期causation / hop map、配送 | Conversation開始・継続に必要なmetadataを解決する |
| `src/application/agent-runtime.ts` | Event正規化、recipient導出、reply配送 | Conversation contextをEvent / Outboxへ接続する |
| `src/infrastructure/persistence/schema.ts` | Runtime永続状態 | Design checkpointで必要と判断した場合だけDrizzle schemaを追加する |
| `src/infrastructure/persistence/postgres-runtime-persistence.ts` | Event / Run commit | Conversation監査・更新を既存transaction境界へ統合する候補 |
| `src/testing/in-memory-runtime-persistence.ts` | test double | Conversation persistenceを採用した場合に追随する |
| `src/infrastructure/agent/model-json-schema.ts` | Agent Core出力schema | Goal出力が必要な設計の場合だけ最小限変更する |
| `src/infrastructure/agent/deep-agent-prompt.ts` | 最小system prompt | Scheduled Task共通原則だけを維持し詳細をskillへ移す |
| social-message / scheduled-task skill | Event別の判断規則 | Goal継続・終話、Task作成境界を記述する |
| `src/infrastructure/tools/scheduled-task-tools.ts` | Tool description / schema | 明示将来依頼と自己予約例外を説明する |
| `src/infrastructure/persistence/postgres-scheduled-task-tool-repository.ts` | Scheduled Task保存 | 作成理由又は起点の監査が不足する場合に更新する |
| `tests/contract/discord-adapter.contract.test.ts` | reply chain正規化・配送 | human / peer共通の開始・継続・新規会話を検証する |
| `tests/system/discord.test.ts`, `tests/system/observation-gate.test.ts` | 社会的Eventの一連動作 | Goal継続、終話、非reply新規会話を検証する |
| `tests/unit/agent-prompts.test.ts` | skill / prompt契約 | Goal / Desire / Concern / Scheduled Task境界を検証する |
| `tests/unit/scheduled-task-tools.test.ts`, `tests/unit/scheduler.test.ts` | Task作成・実行 | 作成境界と既存実行経路を検証する |
| Debug UI query / page / tests | Conversation監査表示 | Design checkpointで採用した監査形を表示する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | Conversation GoalとC-08のScheduled Task境界 | 反映済み（本Issue作成までの会話方針） |
| `spec/personal-agent-implementation-design-v2.md` | Conversation state、Runtime / LLM責務境界 | 反映済み |
| `docs/REQUIREMENTS.md` | 変更要件と必要な新規FR / AC | 反映済み |
| `docs/ARCHITECTURE.md` | Conversation正本、reply解決、永続化判断 | 反映済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 通常会話フロー | 反映済み |
| `docs/AGENT_MOTIVATION_MODEL.md` | 関係図上のConversation Goal境界 | 反映済み |

## Acceptance criteria

- [x] AC-074-1：実装前のDesign checkpointで、Conversationの正本、所有者、開始・継続・終了、Goalの形成・更新、再起動、監査、Memory / Concern / Scheduled Task境界が文書化され、未決の重要判断がない。
- [x] AC-074-2：human / peerを問わず、Agentが通常投稿へreplyするとConversationが始まり、その自Bot発話への返信だけが同じConversation Goalを継続する。非reply投稿、別root又は解決不能なreplyは新しい候補として扱う。
- [x] AC-074-3：同じDiscord reply chainへ複数Agentが参加しても、Goal、進捗、終了状態はAgentごとに所有され、別Agentの心理状態を共有しない。
- [x] AC-074-4：Conversation Goalは複数Eventで安定し、各EventのDesireは今回の行為だけを表す。直前発話の細部によってGoal全体が暗黙に置換されない。
- [x] AC-074-5：結論・判断・必要な問い・反論・新事実・次行為を実質的に変えない同意、礼儀、言い換え、細部追加だけでは返信せず、`no-external-action`でConversationを終了又は待機状態へ移す。
- [x] AC-074-6：Goal達成後に実行可能な行為がある場合はTool / Actionへ移り、会話の手順分解を続けない。会話外に残る関心だけがConcernとなる。
- [x] AC-074-7：Scheduled Taskは主としてhumanから明示された将来・定期実行依頼で作成され、会話上の次の一手、細かな実験手順、文言調整、単なる再検討では作成されない。
- [x] AC-074-8：Agent自身のScheduled Task作成は、特定時刻にしか成立しない観測・時間差比較・明示的な将来履行など、例外理由を説明・監査できる場合に限られる。特定語又は単純な文字列一致で判定しない。
- [x] AC-074-9：ConversationとScheduled Taskのmodel-facing schema / skill / Tool descriptionは必要十分で、system promptへ詳細を重複させず、永続IDをLLMへ入出力させない。
- [x] AC-074-10：新規ConversationのGoal、状態、対応Event、終話理由と、Scheduled Taskの作成起点・理由を監査query又はDebug UIで確認できる。過去会話の表示互換は不要。
- [x] AC-074-11：差分が正の文書に反映され、上流への反映がすべて反映済み又は不要となり、`spec-analyze change`でCRITICAL / HIGHがない。

## Tests

- FR-88, FR-90, FR-92：humanとpeerの通常投稿へreplyするとConversationが始まり、そのreplyへの返信が同じAgent所有Goalを継続するcontract / system test。
- FR-21, FR-76, FR-90：Goalに実質的な進展がない礼儀・同意・言い換えだけの返信を`no-external-action`で終え、Outboxを作らないsystem test。
- FR-21, FR-90：具体的な問い、反論、新事実又は次行為が残る時だけ、同じGoalの下で新しいDesireと一つのreplyを作るsystem test。
- FR-88, NFR-8, NFR-17：別root、Map / state miss、期限切れ、再起動方針、複数Agent所有境界、重複受信をRuntime / persistence testで確認する。
- FR-40：humanの明示的な単発・定期将来依頼でTaskを作成できること、将来時刻を必要としない会話上の次行為では作らないことをprompt / live又はsystem testで確認する。
- FR-40, NFR-17：Agent自己予約例外の理由とsource Eventを監査でき、Scheduled Taskが期限到来時だけ既存System Event経路で一度実行されるintegration test。
- FR-40, FR-90：Scheduled Task、Conversation Goal、Desire、Concernの境界がskill / Tool description / schema descriptionに存在し、最小system promptへ重複していないunit test。
- NFR-17：Debug UI又は監査repositoryが新規ConversationのGoal、進捗、状態、終話理由とTask作成理由をread-backできるtest。

## 実装メモ

- Conversationの意味的正本を`conversations`、Discord外部messageとの対応を`conversation_messages`へ保存した。対応はAgent所有で名前空間化し、Conversation開始前の自律発話も永続化する。process内Mapはhop・因果補助に限定した。
- Conversation開始時に同じcorrelationの事前outbound対応をbackfillする。終了後は元のoutboundへのreplyから終了済みGoalを再開せず、新しい会話候補として扱う。
- Goalは初回の具体的目的を保持し、各EventのDesireと分離した。進捗・未解決点・turn数はEvent、Desire、Memory、message対応から導出し、Conversationへ重複保存しない。
- Scheduled Taskの作成境界を`social-message` / `scheduled-task` skillとTool descriptionへ置いた。作成理由を必須化し、source Eventとともに監査できる。
- Drizzle schemaを正としてmigration `0045`〜`0048`を生成した。手書きmigrationは追加していない。
- 検証：`pnpm verify`成功（unit / contract 281、integration 70、system 63、evaluation 15）。`trace_check.py`はERROR 0、既存範囲外WARN 8。
- レビュー：`docs/work/reviews/2026-11-23-issue-074.md`（指摘なし）。仕様照合：`docs/work/analyze/2026-11-23-change-074.md`（CRITICAL / HIGH / MEDIUM / LOWすべて0）。
