---
created_at: 2026-10-19
status: done
type: change
plan: []
requirements: [C-04, C-06, C-07, C-15, C-25, FR-3, FR-8, FR-25, FR-43, FR-44]
requires: agent
---

# 002 ConcernとDesireの境界を統一し、Desireを次のstepへ引き継ぐ

元計画：なし（会話起点）

## Background

ユーザーとの整理により、次の意味を維持する。

- **Concern**：複数Eventにまたがる、気に掛けていること。永続状態。
- **Desire**：今回のEventで「今、何をしたいか」を表す、現在のコミットメント。永続状態ではない。
- 順序は **Concern → Desire → Action**。

概念設計でも、Concernは「現在気に掛けていて、次のEventにも影響する未解決事項」、Desireは「今回のEventを受けて『今、何をしたいか』を表す今回限りの判断」とされる（[概念設計 §8](../spec/personal-agent-concept-design-restructured-v2.md#L234-L261)）。保存済みConcernが空でも行動を止めないとも明記されている（[実装設計 §12](../spec/personal-agent-implementation-design-v2.md#L327-L347)）。

現状には次の3つの問題がある。

1. system promptが「`concern_list`が空なら、`concern_propose`で具体的なConcernを原則1件作る」としており、DesireとConcernを混同し、低品質なConcernの蓄積を招く（[deep-agent-prompt.ts](../src/infrastructure/agent/deep-agent-prompt.ts#L27-L34)）。
2. DesireはAgent Coreの最終出力に含まれるが、次のEventへ引き継がれない。そのため、Tool loop後の後付け説明になりやすい。
3. ConcernとDesireの入力契約が曖昧で、DesireがConcernの言い換えになり得る。

ユーザー判断により、Concern作成の境界を次とする。

- **user-message**：Concernを作らない。`concern_propose`も使わない。会話中の未解決意図は`remember`、`schedule_task`、または保存しないに委ねる。
- **idle / concern-due**：既存Concernへ接続し、必要なら`concern_propose`で作成・補充する。
- **Reflection**：既存Concernの整理・統合・具体化・終了に加え、Memory根拠付きで新しいConcernを作成できる。

Feelingは`previousAssessment`としてMeaning / Feeling / `occurredAt`を次のEventへ1件渡し、経過時間、重要性、未解決性、現在Eventとの関連から残っている影響だけを使う設計になっている（[AGENT_MOTIVATION_MODEL.md](../docs/AGENT_MOTIVATION_MODEL.md#L29-L48)）。Desireも同じ形で引き継ぐ。

## Dependencies

- Issue 001（同じprompt / Tool description / 状態取得フローを更新するため、先に001を完了する）

## Scope

### 1. specの修正

- `spec/personal-agent-concept-design-restructured-v2.md` C-06を修正する。
  - Concernは、感情・価値・関係・未完了課題を含む「気に掛けていること」であり、未解決課題だけではない。
  - Desireは、Concern・現在Event・Self・Memory・Feeling / Mood・Relationship・`previousDesire`から形成する、今回の現在のコミットメントである。
  - Desireは永続状態ではないが、直前stepのDesireを`occurredAt`付きで次の判断へ1件渡してよい。
  - 次のEventでは、経過時間、前回Actionの結果、現在Eventとの関連から、まだ現在のDesireか判断する。
  - DesireはConcernの言い換えではなく、具体的な対象と今回の行為を持つ。
  - C-06内の「Concern = 未解決事項」「`description`: 何が未解決か」を、未解決課題に限らない「気に掛けていること」へ合わせる。
  - `previousDesire`は独立したDesire状態ではなく、直前runの出力を1件渡すtransient inputであり、C-06の「独立したDesire状態は使用しない」と矛盾しない。
  - Concern作成はuser-messageでは行わず、idle / concern-due / Reflectionで行う。
- `spec/personal-agent-implementation-design-v2.md` §5.2、§12、§13、§18、§19を修正する。
  - `AgentCoreInput`へ`previousDesire`を追加する。
  - ConcernとDesireの入力契約、時間軸、永続性の違いを明記する。
  - `previousDesire`は直前の成功runから導出し、新しい永続DB fieldやtableを追加しない。
  - Desireが現在のEventに優先されないこと、前回Actionで満たされたDesireを繰り返さないことを明記する。
- `spec/personal-agent-implementation-design-v2.md` §23.2を修正する。
  - Reflectionは、既存Concernの整理・統合・具体化・終了に加え、Memory根拠と`whyItMatters`を伴う新しいConcernを1回1〜3件まで作成できる。
  - 入力にない事実・ID・関係から作らない。既存Concernとの重複を統合する。
  - 新規Concernの作成はReflectionの明示的な`create`操作とし、RuntimeがIDを付与する。
- C-06と§23.2の変更はユーザー承認済み（2026-10-20）として扱う。

### 2. 実装

- `AgentCoreInput`へ次の形の`previousDesire`を追加する。

```ts
type PreviousDesire = {
  desire: string;
  occurredAt: string;
};
```

- Context Loaderは、直前の成功runの`result.output.desire`とEventの`occurred_at`から`previousDesire`を1件構築する。失敗runは使わない。
- Context BuilderとAgent Coreの初期入力へ`previousDesire`を含める。Context予算を悪化させない。
- system promptへ次の規則を追加する。
  - `previousDesire`は前回の意図であり、義務ではない。
  - 現在のEvent、特にユーザー入力が優先である。
  - 経過時間、前回Actionの結果、現在Eventとの関連から、まだ現在のDesireか判断する。
  - 前回Actionで満たされた、古い、無関係なDesireは使わない。
  - Desireは、対象、今回の行為、どのConcern / Feeling / Relationshipに応えるかを含む。
  - Desireを既存Concernの言い換えにしない。
- `concern_propose`のTool descriptionを、未解決課題だけでなく、知りたい、確かめたい、共有したい、守りたい、感情的なしこり、関係の継続を含む説明へ更新する。
- `desire`のschema descriptionを、今回の現在のコミットメントであり、Concernの言い換えではないことが分かる説明へ更新する。
- ReflectionのConcern変更に`create`操作を追加し、RuntimeがIDを付与する。`create`はMemory根拠と`whyItMatters`を必須とし、1回1〜3件までとする。
- user-messageでは`concern_propose`を非表示にする。Issue 001と整合させる。

### 3. ドキュメント

- `docs/AGENT_MOTIVATION_MODEL.md`へ、Concern / Desire / `previousDesire`の時間軸と入力契約の表を追加する。
- `docs/REQUIREMENTS.md`へ、`previousDesire`の引き継ぎとConcern / Desireの区別を追加する。
- `docs/ARCHITECTURE.md`へ、Context Loader / Context Builder / Agent Core Inputの変更を反映する。
- `docs/TEST_STRATEGY.md`へ、即時引き継ぎ、時間経過、満足済みDesire、言い換え防止の検証を追加する。

## Out of scope

- Desireを永続状態として保存する新しいDB field、table、`currentDesire` stateの追加。
- 固定TTLや数値の時間減衰。Feelingの`previousAssessment`と同じく、`occurredAt`と現在Eventとの関連でモデルが判断する。
- DesireとActionを分けるための追加LLM callや二段階出力。
- Desireの削除。Desireは現在のコミットメントとして維持する。
- Concernのstatus（active / satisfied / abandoned）の再設計。
- Reflectionが無制限にConcernを増やすこと。1回1〜3件の上限とMemory根拠を設ける。
- `previousDesire`をRecent Experiencesへ複製すること。Recent ExperiencesのAction結果と役割が重複するため、このIssueでは独立した1件の入力として扱う。
- 社会基盤とユーザー関心の深さ制御。Issue 004で扱う。

## Implementation notes

- `previousDesire`は`previousAssessment`と同じく、直前の成功Eventから1件だけ渡す。複数件や履歴は渡さない。
- Context Loaderでは、`agent_runs.result.output.desire`が文字列で、`finished_at`が非NULL、`failure_reason`がNULLの最新runだけを対象にする。
- `previousDesire.desire`は既存の`desire`上限（800文字）に収める。`occurredAt`はEventの発生時刻を使う。
- promptでは、`previousDesire`を「前回の意図」として提示し、現在のEventのObservationより優先しない。
- 前回Actionの結果はRecent Experiencesから参照できる。Desireが満たされたか、進展がなかったかを合わせて判断する。
- Concern生成では、Feeling / Mood / Relationship / Self / Memoryを入力に使う。特に、感情から生じた「確かめたい」「共有したい」「連絡したい」「守りたい」をConcernの正当な内容として扱う。
- user-messageではConcernを作らない。`concern_propose`を非表示にし、会話中の未解決意図は`remember` / `schedule_task` / 保存しないに委ねる。
- idle / concern-dueでは、既存Concernが空でも空でなくても、必要に応じて`concern_propose`で作成・補充する。
- Reflectionでは、既存Concernの整理・統合・具体化・終了に加え、Memory根拠付きの新規Concernを1回1〜3件まで作成できる。`concernChanges`に`create`操作を追加し、RuntimeがIDを採番する。
- Concernは「次のEvent以降も気に掛けるか」を通過した場合だけ提案する。今回のActionで解決する一回限りのものはDesireに留める。
- Desireは「選んだConcernを今回どう具体化するか」を書く。Concernの説明をそのまま繰り返さない。
- 既存の`tests/system/tool-loop.test.ts`の「concern_listが空でもconcern_proposeを残す」testは、Toolの可用性と、呼ぶべきでない条件を分けて確認する。
- `tests/integration/persistence.test.ts`のContext Loader testへ`previousDesire`の読み込みを追加する。
- `tests/unit/memory-context.test.ts`などContext Builderのbudget testへ`previousDesire`の上限を追加する。
- `tests/unit/agent-prompts.test.ts`へ`previousDesire`とDesire / Concernの区別のprompt testを追加する。
- Evaluationでは、直前Eventとの時間差が小さい場合と大きい場合をpairにし、Desireの採用・不採用が変わることを確認する。

## Acceptance criteria

- [x] AC-6：直前の成功runのDesireが`occurredAt`付きで次のAgent Coreへ1件渡り、現在のEventにふさわしい場合だけ現在のDesireとして使える。
- [x] 前回Actionで満たされたDesire、古いDesire、現在Eventと無関係なDesireを繰り返さない。
- [x] Concernは永続、Desireは現在のコミットメントとして、specとdocsで区別されている。
- [x] Concernの生成入力にFeeling / Mood / Relationship / Self / Memoryが含まれ、未解決課題だけに偏らない。
- [x] Concernが空でも、Event・Feeling・Relationship・MemoryからDesireを形成し、具体的なActionを選べる。
- [x] DesireがConcernの言い換えにならず、対象・今回の行為・応えるConcern / Feelingを含む。
- [x] user-messageではConcernを作成しない。
- [x] ReflectionはMemory根拠付きで新しいConcernを1回1〜3件まで作成できる。既存Concernの整理・統合・具体化・終了も継続する。
- [x] `previousDesire`のために新しい永続DB fieldやtableを追加していない。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて「反映済み」または「不要」になっている。
- [x] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- 追加要件（Desire handoff）：直前の成功runから`previousDesire`が1件読み込まれる。
- 追加要件（Desire handoff）：Desireのないrunからは読み込まれない。
- 追加要件（Desire handoff）：直近Desire、古いDesire、満たされたDesireの評価scenarioで採用差を確認する。
- 追加要件（Concern/Desire）：DesireがConcernの言い換えにならないことをsemantic rubricで確認する。
- 追加要件（Desire handoff）：失敗runやDesireのないrunからは読み込まれない。
- 追加要件（Desire handoff）：`previousDesire`がpromptへ`occurredAt`付きで含まれる。
- 追加要件（Desire handoff）：直前Actionで満たされたDesireを繰り返さない。
- 追加要件（Desire handoff）：時間が開いたEventでは、古いDesireを現在のDesireとして採用しない（evaluation fixture）。
- 追加要件（Concern/Desire）：Concernが空のuser-message / idle Eventでも、Event・Feeling・Relationship・MemoryからDesireを形成する。
- 追加要件（Concern/Desire）：Feeling / RelationshipからConcernが生成され、未解決課題だけに偏らない。
- 追加要件（Concern/Desire）：user-messageではConcernを作成しない。
- 追加要件（Concern/Desire）：idle / concern-dueでは必要に応じて`concern_propose`で作成・補充する。
- 追加要件（Concern/Desire）：ReflectionはMemory根拠付きで新しいConcernを作成できる。
- 追加要件（Concern/Desire）：Reflectionの新規Concernは1回1〜3件までで、根拠のない作成を拒否する。
- 追加要件（Concern/Desire）：Reflectionが作成した`reconsiderAt`付きConcernは`concern-due` scheduleへ同期される。
- 追加要件（Concern/Desire）：DesireがConcernの言い換えにならず、具体的な対象と行為を含む（evaluation fixture）。
- FR-3：`desire`のschema descriptionとpromptが、今回の現在のコミットメントを要求する。
- FR-8、FR-25：既存のConcern lifecycle testが引き続き通る。
- C-06、C-07：`previousAssessment`と`previousDesire`の時刻の扱いが同じ規則になっている。
- typecheck、lint、関連unit / integration / system / evaluation test。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-06 | Concernは感情・価値・関係を含む気に掛けていること。Desireは現在のコミットメント。`previousDesire`をtimestamp付きで引き継ぐ | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | （IDなし）§5.2、§12、§13、§18、§19 | Concern / Desireの入力契約、`previousDesire`、永続性の区別 | spec/personal-agent-implementation-design-v2.md |
| MODIFIED | （IDなし）§23.2 | Reflectionによる新規Concern作成を許可し、Memory根拠・`whyItMatters`・1回1〜3件の上限を設ける | spec/personal-agent-implementation-design-v2.md |
| ADDED | FR-44 | ReflectionはMemory根拠付きで新しいConcernを1回1〜3件まで作成できる | docs/REQUIREMENTS.md |
| MODIFIED | FR-8 | Concernは複数Eventにまたがる気に掛けていることで、Desireと区別する | docs/REQUIREMENTS.md |
| MODIFIED | FR-25 | Concernの永続化判断に、行動後の未解決性と次Eventへの影響を含める | docs/REQUIREMENTS.md |
| ADDED | FR-43 | 直前の成功runのDesireを`occurredAt`付きで次のAgent Coreへ1件渡す | docs/REQUIREMENTS.md |
| ADDED | AC-6 | previousDesireの引き継ぎとReflectionの新規Concern作成を検証する | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`previousAssessment`、`previousDesire`、`desire`、`Concern`、`concern_propose`、`AgentCoreInput`、`ContextBuilder`、「経過時間」、「前回のAssessment」、「原則1件」

| 場所 | 内容 | 対応 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-06 | Concern / Desireの定義と永続性 | 更新する |
| spec/personal-agent-concept-design-restructured-v2.md C-07 | Feeling / Moodの時間変化 | 影響を確認する（既存のpreviousAssessment方針は維持） |
| spec/personal-agent-implementation-design-v2.md §5.2 | Concernを未解決事項に限らない「気に掛けていること」へ | 更新する |
| spec/personal-agent-implementation-design-v2.md §12 | DesireとConcern | 更新する |
| spec/personal-agent-implementation-design-v2.md §13 | DesireとAction | 更新する |
| spec/personal-agent-implementation-design-v2.md §18 | Agent Core Input | `previousDesire`を追加する |
| spec/personal-agent-implementation-design-v2.md §19 | Agent Core Output | Desireの意味と引き継ぎを追記する |
| spec/personal-agent-implementation-design-v2.md §23.2 | ReflectionのConcern作成制限 | 更新する |
| src/domain/contracts.ts | `AgentCoreInput`、`AgentDesire` | 更新する |
| src/application/context-builder.ts | `previousDesire`のboundと入力 | 更新する |
| src/infrastructure/persistence/postgres-agent-context-loader.ts | 直前成功runから`previousDesire`を構築 | 更新する |
| src/infrastructure/agent/deep-agent-harness.ts | promptInputと`desire` schema description | 更新する |
| src/infrastructure/agent/deep-agent-prompt.ts | previousDesire、Concern / Desireの入力契約 | 更新する |
| src/evaluation/scenarios.ts | Desire handoff / stale / satisfiedの評価pair | 追加する |
| src/evaluation/runner.ts | semantic rubricのみで判定するpairの許容 | 更新する |
| src/infrastructure/tools/agent-context-tools.ts | `concern_propose`、`concern_list`の説明 | 更新する |
| src/domain/contracts.ts | `ConcernChangeSchema`へ`create`を追加 | 更新する |
| src/application/reflection.ts | `create`の検証とID採番 | 更新する |
| src/infrastructure/agent/reflection-harness.ts | Reflection promptと`concernChanges` schema | 更新する |
| src/infrastructure/persistence/postgres-reflection.ts | 新規Concernのcommit | 更新する |
| tests/unit/reflection.test.ts | Reflectionの新規作成・上限・根拠 | 追加する |
| src/application/agent-runtime.ts | run resultの保存 | 変更しない（既存の保存を使う） |
| tests/integration/persistence.test.ts | Context Loaderの`previousDesire` | 追加する |
| tests/unit/memory-context.test.ts | Context Builderのbudgetと`previousDesire` | 追加する |
| tests/unit/agent-prompts.test.ts | promptの`previousDesire`、Desire / Concern | 追加する |
| tests/system/tool-loop.test.ts | Concern空時のTool可用性と非作成 | 更新する |
| tests/evaluation/evaluation-runner.test.ts | 評価fixtureの構造test | 追加する |
| docs/AGENT_MOTIVATION_MODEL.md | Concern / Desire / previousDesireの表 | 更新する |
| docs/REQUIREMENTS.md | FR-8、FR-25、FR-43、FR-44、AC-6 | 更新する |
| docs/ARCHITECTURE.md | Context Loader / Builder / Input | 更新する |
| docs/TEST_STRATEGY.md | 検証対応 | 更新する |
| issues/001-user-message-state-retrieval.md | `previousDesire`は002で扱う境界 | 必要なら追記する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-04 | 状態を主観的意味に使う | 不要 |
| spec/personal-agent-concept-design-restructured-v2.md C-06 | Concern / Desireの定義、previousDesireの引き継ぎ | 反映する（ユーザー承認済み 2026-10-20） |
| spec/personal-agent-concept-design-restructured-v2.md C-07 | Feeling / Moodの時間変化 | 不要（previousAssessmentの既存方針を使う） |
| spec/personal-agent-concept-design-restructured-v2.md C-15 | 時間経過による変化 | 不要 |
| spec/personal-agent-implementation-design-v2.md §12 | DesireとConcern | 反映する |
| spec/personal-agent-implementation-design-v2.md §13 | DesireとAction | 反映する |
| spec/personal-agent-implementation-design-v2.md §18 | Agent Core Input | 反映する |
| spec/personal-agent-implementation-design-v2.md §19 | Agent Core Output | 反映する |
| spec/personal-agent-implementation-design-v2.md §23.2 | Reflectionの新規Concern作成 | 反映する（ユーザー承認済み 2026-10-20） |
| spec/personal-agent-implementation-design-v2.md C-25（§22） | Reflectionが長期状態を確定する | 不要（Memory根拠と理由の原則は維持） |
| docs/AGENT_MOTIVATION_MODEL.md | Concern / Desire / previousDesire | 反映する |
| docs/REQUIREMENTS.md | FR-8、FR-25、追加要件、AC | 反映する |
| docs/ARCHITECTURE.md | Context Loader / Builder / Input | 反映する |
| docs/TEST_STRATEGY.md | 検証対応 | 反映する |

## 実装メモ

- `AgentCoreInput`へ`previousDesire`を追加し、Context Loaderが直前の成功runから1件読み込む。Context Builderで800文字に制限し、Agent CoreのpromptInputへ渡す。
- promptと`desire` schema descriptionへ、previousDesireの経過時間・前回Action結果・現在Eventとの関連による採用判断、Concernの言い換え禁止を追加した。
- Reflectionの`concernChanges`へ`create`を追加し、Memory根拠と`whyItMatters`を必須、1回1〜3件、`status: active`に限定した。RuntimeがIDを採番する。
- `ReflectionOutputSchema`と`ReflectionModelOutputSchema`の両方で上限・根拠・必須fieldを検証する。
- テスト: `tests/unit/reflection.test.ts`、`tests/unit/reflection-harness.test.ts`、`tests/unit/memory-context.test.ts`、`tests/unit/agent-prompts.test.ts`、`tests/contract/agent-harness.contract.test.ts`、`tests/integration/persistence.test.ts`、`tests/evaluation/evaluation-runner.test.ts`、`src/evaluation/scenarios.ts`を更新。
- Evaluationへrecent / stale / satisfied previousDesireのpairと、Desireのparaphrase防止rubricを追加した。行動方向を仮定できないpairはsemantic rubricで判定する。
- promptから空Concern時の強制作成を外し、Concernのlifecycle promptと`concern_propose` descriptionを「気に掛けていること」へ更新した。
- Reflection commitで`reconsiderAt`付きConcernの`concern-due` scheduleを同期する。
- 検証: typecheck、lint、unit 148件、system 42件、evaluation 14件、integration persistence 25件が通過。
- レビュー記録: [docs/work/reviews/2026-10-21-issue-002.md](../docs/work/reviews/2026-10-21-issue-002.md)
