---
created_at: 2026-11-25
status: done
type: change
plan: []
requirements: [FR-24, FR-25, FR-39, FR-69, FR-95, NFR-6, NFR-7, NFR-22]
ui: []
requires: agent
---

# 094 経験単位でConcern再検討を束ねる

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)、[#078](078-replace-concern-time-schedules-with-coalesced-signals.md)、[#079](079-derive-concerns-from-new-experience.md)

## Background

現行の`concern-due` signalはMemory writeごとに発行される。一つのExperience Integrationが複数Memoryを保存した場合や、遅延していたIntegrationが短時間に完了した場合、Agent単位でsignalをcoalesceしていても、claim完了後に次のsignalが作られ、Concernを連続して再検討する。

実DBで`4890118e-4af9-4395-ae76-99fd2211c981`を確認したところ、起動自体は直前Integrationが作った2件のMemoryに基づく正常なsignalだった。一方、Event payloadには経験根拠がなく、Agentが任意Toolの`concern_due_focus`を使わなかったため、`event_search`だけで根拠なしと判断した。Tool呼び出しを必須化して処理を成立させるのではなく、Concernを「Memory保存のたびに処理するTask」ではなく「経験により変化しうる持続的動機」として扱う必要がある。

## Dependencies

- #078 done
- #079 done
- #080 done
- #084 done

## Scope

- Experience Integration又はMemory updateの一回の確定を、Concern再検討の最小入力単位である`experience batch`として永続化する。
- batchには起点Event / Run又はMemory mutation sourceへの参照、統合完了時刻、作成・更新Memory参照、Runtime解決済みFocus Concern、impact判断、claim / retry / consume状態を保持する。経験要約の正本は既存のEvent ExperienceとMemoryであり、batchへ本文を複写しない。既存Event、Run、Memory、Concern、Activityの意味的正本を複製しない。
- Runtimeがsubject・時刻・embedding・keyword等で候補Concernを機械的に絞り、短いLLM判定で「既存Concernの意味・優先度・向きに再検討が必要か」を決める。Memory保存そのものを再検討根拠にしない。
- pending batchをAgentとRuntime選択済みFocus Concernの組で集約窓内に束ね、対象Concernと経験要約を含む一つの`concern-due` Eventとしてclaimする。一回のEventは親Concern一件だけを扱い、複数Concernが類似しているかの統合はReflectionに委ねる。実行中のAgentへ重ねて起動しない。
- `concern-due`の入力にRuntime解決済みの経験要約・候補Concernを含める。`concern_due_focus`は追加調査の任意Toolとし、呼ばれなくてもderive / no-opの判断が破綻しないようにする。
- `concern-due`は既存Concernからのderive + forkだけを扱う既存境界を保つ。Experience IntegrationのFocus Concernについてのprogress / satisfied / abandonedはFR-95の同一Event境界で扱う。
- consume後もbatchと根拠参照を監査可能に残し、なぜ`concern-due`が起き、何を判断し、何も変えなかったかをDebug read modelで追跡可能にする。
- schema、Drizzle migration、repository、scheduler、Agent Runtime、skills / schema description、Debug UI、既存signalからのdata migration、テスト、関連文書を更新する。

## Out of scope

- active Concern件数やclose率に基づく自動調整。
- Concernの本文意味を単語一致だけで更新・closeすること。
- `concern-due`をConcernの統合・satisfied・abandonedの主経路へ広げること。
- Experience Integration、Memory、Concernの完全な履歴JSONを新しいbatchへ複写すること。

## 詳細設計

### Batch形成とimpact判定

1. Experience Integration又は通常のMemory updateが実際にMemory create / updateをcommitした時だけ、同一source kind / source IDを一意キーとするbatch候補を作る。Memory書込みがない場合は作らない。Reflection Formation / Reconciliationは同一Session内でConcern整理を担うため、ここからbatchを作らない。
2. RuntimeはbatchのMemory群をqueryとしてactive Concernをsubject・時刻・embedding・keywordで候補化し、最高順位の一件だけをFocus Concernとして選ぶ。候補がなければbatchを`discarded`として監査に残し、`concern-due`を起動しない。
3. Focus Concernがある時だけ、既存Event Experience、batchの新規・更新Memoryの短いview、Focus Concernの関心核と重要性を軽量LLMへ渡す。LLMは`none | reconsider`と短い理由だけを返す。Concern ID、Memory ID、Event ID、候補番号、status操作を出力しない。
4. `none`は`discarded`として残し、`reconsider`だけをpending batchにする。Focus ConcernはRuntimeが既に束縛しているため、モデル出力をcanonical IDへ逆引きしない。
5. batchはまず`assessing`として確定する。軽量impact判定が失敗してもExperience Integration又はMemory writeを巻き戻さず、batchだけを`failed`としてlease / backoff付きで再試行する。

### claim、集約、再試行

- schedulerはAgentとFocus Concernの組ごとのpending batchを集約窓の後に一つだけclaimする。claim済み又は実行中なら新規batchは次回へ残す。異なるFocus Concernのbatchを一Eventへ混在させず、Concern間の類似・統合はReflectionに委ねる。
- 一つの`concern-due`に含めるbatch数、経験要約数、Concern数には小さな上限を置く。超過分はpendingのまま次回へ残す。
- Event payloadにはbatch ID、source IDではない自然言語の経験要約、Runtime解決済みのFocus Concern viewを渡す。永続IDはモデルへ出さない。
- 成功時はclaimしたbatchを`consumed`、失敗時は同一batch集合をretry可能なpending状態へ戻す。新たなEventを増殖させない。

### lifecycleと監査

- `concern-due`がcommitできるConcern操作はderiveだけである。親Concernのupdate、status変更、replace、外部探索の完遂、予定実行を認めない。
- RuntimeはEvent開始時にFocus ConcernとbatchのMemory根拠をRun-localへ束縛する。`concern_propose(derive)`はToolを事前に呼ばなくてもこの束縛へ保存する。`concern_due_focus`は追加調査用に残してよいが、派生の成立条件にしない。
- 派生の根拠はclaim batchからRuntimeが`concern_activities`へ保存する。モデルがIDや根拠Recordを指定しない。

### Reflectionとの共通化境界

- ReflectionのMemory Formation batchは、固定Session内の最大16 Eventから長期Memoryを作るmaintenance単位である。experience batchは、一つのEvent処理後に確定したMemory群が現在の動機へ影響するかを扱うlifecycle単位である。両者のtable、status、inputを共用しない。
- `MemoryWriteService`、Memory mutation監査、embedding準備、Hybrid Retrievalのtoken化・vector / keyword score、RuntimeによるID非露出のFocus束縛、claim / lease / retryの状態遷移規約は共有する。
- Reflection Formationの「候補Memory → fixed Event window」の根拠解決と、experience batchの「Memory群 → active Concern」の候補化は検索方向と意味が異なる。低位のHybrid Ranking helperだけを抽出し、高位のresolverは分ける。
- Event observationとDebug UIは、発火したbatch数、経験要約、候補Concern数、impact理由、consume / discard / retry結果を表示する。signal rowを唯一の監査正本にしない。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-06 | Concern派生を、Memory単位でなく経験batchを受けたlifecycle再検討として定義する | `spec/personal-agent-concept-design-restructured-v2.md` |
| MODIFIED | C-17 | `concern-due`を経験batchの集約Eventとし、起動・入力・発話任意を明確化する | `spec/personal-agent-concept-design-restructured-v2.md` |
| MODIFIED | FR-24 | signalの正本・coalesceをexperience batchとAgent単位claimへ変更する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-69 | `concern-due`が入力済みの経験batchから派生だけを判断することを明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-6 | batch claim / lease / retryの冪等性を追加する | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-7 | batchとConcern Activityを用いた発火・判断監査を追加する | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-22 | 候補検索とID対応はRuntime、意味的impactはLLMとする | `docs/REQUIREMENTS.md` |

## 影響範囲

検索した語：`concern-due`、`concern_reevaluation_signals`、`enqueueConcernReevaluationSignal`、`concern_due_focus`、`FR-24`、`FR-69`

| 場所 | 内容 | 対応 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-06 / C-17のConcern Event責務 | 更新する |
| `docs/REQUIREMENTS.md` | FR-24、FR-69、NFR-6、NFR-7、NFR-22 | 更新する |
| `docs/AGENT_MOTIVATION_MODEL.md` | Concern lifecycle図とEvent表 | 更新する |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | Experience IntegrationからConcern再検討への流れ | 更新する |
| `docs/TEST_STRATEGY.md` | Concern signalのUnit / Integration / System検証 | 更新する |
| `src/infrastructure/persistence/concern-reevaluation-signal-repository.ts` | Memory単位signalのwriter / claim | batch repositoryへ置換する |
| `src/infrastructure/persistence/postgres-experience-integration.ts` | Integration後signal発行 | batch形成へ更新する |
| `src/infrastructure/persistence/postgres-memory-update-repository.ts` | Memory update後signal発行 | batch形成へ更新する |
| `src/infrastructure/persistence/postgres-schedule-repository.ts` | `concern-due` claim / complete | batch集約claimへ更新する |
| `src/infrastructure/persistence/postgres-agent-context-tool-repository.ts` | `concern_due_focus` | 任意追加調査へ縮小する |
| `src/infrastructure/agent/*` と `skills/concern-due/SKILL.md` | input view、skill、Tool公開 | 更新する |
| `src/infrastructure/persistence/schema.ts` とDrizzle migration | signal / source relation | batch schemaへ移行する |
| Debug UI read model | signal表示 | batch由来の発火理由と結果を表示する |
| tests | signal / scheduler / lifecycle / persistence / system | 更新・追加する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-06 / C-17をexperience batch設計へ更新 | 承認済み |
| `docs/REQUIREMENTS.md` | FR-24、FR-69、NFR-6、NFR-7、NFR-22を更新 | 承認済み |
| `docs/AGENT_MOTIVATION_MODEL.md` | lifecycle図を更新 | 承認済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | Event flowを更新 | 承認済み |
| `docs/TEST_STRATEGY.md` | 検証対応表を更新 | 承認済み |

## Acceptance criteria

- [x] AC-094-1：一回のExperience Integration又はMemory updateが作った複数Memoryは、一つのexperience batchとしてのみConcern再検討候補になる。
- [x] AC-094-2：関連active Concernがない、又は軽量impact判定が`none`のbatchは`concern-due`を起動しないが、discard理由を監査できる。
- [x] AC-094-3：短時間に複数batchができても、Agentごとの集約窓とclaimにより一つの`concern-due`へ束ねられ、同じbatchを重複処理しない。
- [x] AC-094-4：`concern-due`はRuntime解決済みの経験要約と候補Concern viewを受け、`concern_due_focus`を呼ばなくてもderive又はno-opを安全に判断できる。
- [x] AC-094-5：`concern-due`はderive + fork以外のConcern更新をcommitできず、FR-95のFocus Concern更新およびReflectionの整理境界を侵食しない。
- [x] AC-094-6：成功、discard、retry後も、発火元経験・候補・impact判断・派生又はno-opをDebug UI /監査read modelで追跡できる。
- [x] AC-094-7：schema変更はDrizzle schemaと`pnpm db:generate`でmigrationを生成し、既存pending signalを経験batchへ移行するscriptを提供する。
- [x] AC-094-8：正の文書、skill、schema description、testsが更新後の境界へ一致し、`spec-analyze change`でCRITICAL / HIGHがない。

## Tests

- FR-24, FR-69：同じIntegrationで複数Memoryを保存しても、batchは一件、`concern-due`は一回だけになるUnit / Integration test。
- FR-24, NFR-6：連続する複数Integration batchが集約窓内で一つにclaimされ、lease失効・retry後も重複consumeしないIntegration test。
- FR-69, NFR-22：関連Concernがない場合とLLM impactが`none`の場合はEventを起動せず、`reconsider`だけが候補Concern viewを持つEventになるUnit / System test。
- FR-25, FR-95：`concern-due`がderive以外を拒否し、Focus Concernのprogress / satisfied / abandonedがExperience Integration経路に残るSystem test。
- NFR-7：batch source、impact判定、claim、consume / discard / retry、Concern Activityを読取り監査できるIntegration / Debug read model test。
- NFR-8：既存pending signalのmigration dry-run / apply、参照整合性、idempotencyを実DB integration testで検証する。

## 実装メモ

- `concern_reevaluation_batches` とそのMemory参照を追加し、Experience Integration / Memory update後の一回のMemory確定を一件だけ評価する。impact判定が失敗しても元のMemory writeは再実行しない。
- pending batchはAgentとFocus Concernごとにclaimし、自然言語の経験要約だけを`concern-due`へ渡す。canonical IDと根拠Memory IDはRuntimeにだけ束縛し、`concern_due_focus`なしのderiveにも使う。
- 旧signalはreader/writerから除去し、`concern:signals:migrate -- --apply`で監査用のdiscarded legacy batchへ移す。旧tableのdropは移行完了後の別変更で扱う。
- 検証：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm db:migrate:test`、`pnpm db:grant:concerns:test`、`pnpm test:integration`。
- レビュー：`docs/work/reviews/2026-11-26-issue-094.md`。
