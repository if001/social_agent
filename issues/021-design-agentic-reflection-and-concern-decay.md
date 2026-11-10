---
created_at: 2026-11-10
status: stop
type: change
plan: []
requirements: [C-06, C-15, C-25, FR-25, FR-41, FR-42, FR-44, FR-60, NFR-7, NFR-17, 追加]
requires: human
---

# 021 Agent的に取得する分割ReflectionとConcern減衰の上流設計を確定する

元計画：なし（Reflectionの責務、入力過多、Concern lifecycleに関する会話）

## Background

現行ReflectionはSelf、State全体、前回成功Reflection以降のEvent最大32件、直近Memory最大32件を一つの構造化LLM callへ渡す。`agent_states.concerns` は全ConcernをJSONとして保持するため、active Concernが複数育つと、入力量と「全Concernを毎回再評価する」責務がともに肥大化する。8,000推定tokenを超えると現行実装は縮約せず失敗する。

Concernは現在値（`id`、`description`、`whyItMatters`、`status`、任意の`reconsiderAt`）だけを正規に保持する。`state_changes`、`tool_executions`、`reflection_runs` から一部の履歴を後追いできるが、Concern ID単位の作成・進展・レビュー・最終活動を一貫して取得するための保存設計ではない。

Reflectionは「次に何をするか」や外部探索を担わず、複数経験からMemory、Concern、Relationship、Self、Moodへ残る長期的変化を統合・確定するmaintenance処理とする。一方、情報の取得は決定論的な候補絞り込みだけに委ねず、各Reflectorが必要に応じて小さな読み取りToolを繰り返し呼べるagent的な方式を採る。

時間経過はConcernを再検討する材料に留めず、取得・再検討の機会を十分に与えても維持・進展・派生・明示的レビューのいずれにも至らないConcernを決定論的に非activeへ移すためにも使う。ユーザーの未返信はこの根拠にしない。

## Dependencies

- 020（Runtime用完全StateとLLM選択Contextの分離）

## Scope

- 実装・文書変更の前に、Reflection Session / Reflector / Concern Activityが必要とする情報について、現行DB、Event、Run、Tool execution、State change、Reflection run、Memory mutationを実測で監査する。少なくとも次を確認する。
  - Concern IDごとに作成、派生、置換、status変更、Reflectionでの更新を一意に対応付けられるか。
  - 作成時刻、最終meaningful activity、最終review、関連Event / Run / Reflection、関連Memoryを既存記録だけから復元できるか。
  - Eventの話者・subject・因果関係がRelationship Reflectorの根拠として十分か。
  - Memoryの根拠Event、作成・更新・no-op、重複候補がMemory Reflectorの取得に十分か。
  - Reflectionの入力・出力・plan・retry記録が、対象別Reflectorと完全State差分commitの監査に再利用できるか。
- 上記監査では、コード上の経路だけでなく、実DBの既存Agentデータも読み取り専用で確認する。記録が存在しない、ID対応が曖昧、履歴復元が不完全、または既存データ移行が必要という結果は、推測で補わない。
- 監査結果を `docs/work/analyze/` に残し、必要な保存項目・抽出方法・既存データの扱いをIssue 021へ追記する。
- 監査結果が本Issueの提案（最小Concern Activity、対象別Reflector、決定論的クローズ）を支持しない場合、または追加table・schema変更・migration範囲・クローズ規則を実質的に変更する必要がある場合は、一次文書や実装を変更せず、選択肢と影響をユーザーへ提示して承認を得る。
- Reflectionを次の対象別処理へ分離する方針と、依存順を一次文書で確定する。
  1. Memory整理
  2. Concern整理
  3. Relationship整理
  4. Self / Mood統合
- Memory確定後にConcern / Relationshipを扱い、それらの確定結果とMemory根拠を用いてSelf / Moodを最後に扱う。各処理は同一Reflection Sessionの根拠窓を共有する。
- 各Reflectorは外部Webやユーザーへの発話を行わず、自身のEvent、Memory、Concern、Relationship、Run監査記録だけを読み取りToolで調べる。
- Concern本体を運用用fieldで肥大化させず、Concernの作成、focus、進展、派生、レビュー、status変更をcommit層が記録するConcern Activityを正本とする方針を定める。
- Concern Activityに必要な最小項目（Concern ID、種類、時刻、因果となるEvent / Run / Reflection ID、任意の根拠Memory ID）を定める。自由文の重複保存やLLMが自由に書く更新時刻は持たない。
- Concern Reflectorが`concern_list`をページングで全active Concernから取得でき、必要なConcernだけを詳細・履歴・関連Memory・関連Eventへ掘り下げられるTool契約を定める。
- active Concernのうち、決めたstale期間を超えてもReflection Sessionで維持・進展・派生・明示的レビューされなかったものを、Runtimeが決定論的に`abandoned`へ移す規則を定める。既存statusを使い、`dormant`は追加しない。
- stale期間、対象となるActivity種類、クローズ除外条件（具体的な将来`reconsiderAt`を持つ場合など）、クローズ時の監査内容と再活性化規則を定める。
- Reflection用の選択Contextと完全なcommit基準Stateを分離する。選択Contextに含めないConcernがcommitで失われないことを明記する。

## Out of scope

- 一次文書の承認前にschema、DB、Tool、promptを実装変更すること。
- ReflectionにWeb検索、外部操作、ユーザー向けActionを追加すること。
- ユーザーの未返信、Concern件数だけ、単なる固定間隔だけをConcernクローズの根拠にすること。
- Concernを正規化した専用master tableへ全面移行すること。必要なのは最小のActivity監査であり、現在値の表現を直ちに置換しない。

## Implementation notes

### 設計監査ゲート

1. 現行の保存経路と既存DBデータを読み取り専用で調べ、上記Scopeの対応表を作る。
2. 「既存記録だけで可能」「commit層の新規Activityが必要」「既存データのbaseline migrationが必要」「方針変更が必要」に分類する。
3. 3つ目または4つ目が一件でもある場合は、022 / 023を開始せずユーザーへ確認する。
4. ユーザー承認後にだけ、一次文書、022、023の設計・依存関係・受け入れ条件を確定する。

### 提案する処理順

```text
Reflection Session（根拠窓を保存）
  → Memory Reflector
  → Concern Reflector と Relationship Reflector
  → Self / Mood Reflector
```

- Memoryは後続更新の根拠IDを先に確定する。
- ConcernとRelationshipはMemory更新後の同一Session根拠を読む。互いの変更を同一回に再帰的に解釈しない。
- Self / Moodは今回確定したMemory、Concern、Relationshipの要点だけを入力にする。Self更新は通常「更新なし」とする。
- 各Reflectorは必要なだけ読み取りToolを使える。ただし同一Tool・同一入力の反復、Session外への無制限な探索、外部世界への探索はRuntimeで防ぐ。

### Concernの決定論的クローズ案

1. Concern Activityから、active Concernごとの作成時刻、最終meaningful activity、最終reviewを導出する。
2. stale期間を超えたConcernをConcern Reflectorの必須一覧に表示する。LLMがどのConcernを深掘りするかは自由に決める。
3. Session終端時に、stale対象であり、今回のSessionで`reviewed`、`focused`、`progressed`、`derived`、status変更のいずれも記録されなかったConcernを、Runtimeが`abandoned`へ変更する。
4. `reconsiderAt`が将来であるConcern、および今回明示的に継続が確定したConcernはクローズ対象から除く。
5. クローズはConcern ActivityとState changeを記録し、後の関連Event / Memoryで新しいConcernとして再形成できる。過去Concernを暗黙にactiveへ戻さない。

「meaningful activity」が単なる一覧取得ではなく、Focus取得、根拠を伴うレビュー、進展、派生、status変更のどれを指すかは、正の文書で明示する。

## Acceptance criteria

- [ ] 追加：現行の保存データと保存経路が、Reflection Session、Memory / Concern / Relationship / SelfMood Reflector、Concernの減衰・クローズに必要な情報を満たすか、実DBを含む読み取り専用監査で確認し、結果を記録する。
- [ ] 追加：監査結果により保存設計、抽出方法、migration、クローズ規則の変更が必要なら、実装前にユーザーへ選択肢と影響を確認する。
- [ ] C-25：Reflectionの責務を、長期的なMemory、Concern、Relationship、Self、Moodの統合・確定と定義し、通常Action・外部探索・日常的なConcern消化を対象外として一次文書へ反映する。
- [ ] C-06, C-15：Concernの時間減衰、agent的な履歴取得、決定論的な`abandoned`移行の条件を一次文書へ反映する。
- [ ] FR-25, FR-41, FR-42, FR-44, FR-60：対象別Reflector、順序、Tool境界、対象別retry、完全Stateへの差分commitをRequirementsとArchitectureへ反映する。
- [ ] NFR-7, NFR-17：Concern Activityと決定論的クローズが監査・再試行可能であることをRequirementsとTest Strategyへ反映する。
- [ ] 一次文書の承認後、後続の実装Issue 022、023の上流への反映を「反映済み」に更新する。

## Tests

- 追加：仕様分析で、対象別Reflection、Concern Activity、決定論的クローズの要件・受け入れ条件・実装Issueへのtraceが切れないことを確認する。
- 追加：設計監査で得た現行データの代表例に対し、提案する取得経路が必要なConcern / Event / Memory / Relationshipの因果を復元できるかを読み取り検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-06 | Concernのactivity、減衰、決定論的クローズと再形成の位置付けを追加する | `spec/personal-agent-implementation-design-v2.md` |
| MODIFIED | C-15 | 一律時間だけでの削除を禁止する記述を、十分な取得・再検討機会後の決定論的クローズを許容する記述へ変更する | `spec/personal-agent-implementation-design-v2.md` |
| MODIFIED | C-25 | 一括Reflectionを対象別Reflectorと根拠Sessionへ分ける | `spec/personal-agent-implementation-design-v2.md` |
| MODIFIED | FR-25, FR-41, FR-42, FR-44, FR-60 | Concern lifecycleとReflectionの処理・検証を更新する | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-7, NFR-17 | Concern Activity、Session、対象別retryの監査を追加する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-7, ADR-17 | Reflectionの構成と対象別commit / retryを更新する | `docs/ARCHITECTURE.md` |
| MODIFIED | なし | Motivation modelのReflection責務、Concern lifecycle、決定論的クローズを更新する | `docs/AGENT_MOTIVATION_MODEL.md` |
| MODIFIED | なし | 対象別ReflectorとConcern Activityの検証方針を更新する | `docs/TEST_STRATEGY.md` |

## 影響範囲

検索した語：`ReflectionInput`、`ReflectionOutput`、`reflection_runs`、`state_changes`、`ConcernSchema`、`concern_propose`、`reconsiderAt`、`progressChanged`、`FR-25`、`FR-41`、`FR-42`、`FR-44`、`FR-60`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `spec/personal-agent-implementation-design-v2.md` §21-23 | Reflection入力・責務・制約 | 更新する（承認後） |
| `docs/REQUIREMENTS.md` R4, R7, R8 | Concern lifecycle、Reflection、監査 | 更新する（承認後） |
| `docs/ARCHITECTURE.md` ADR-7, ADR-17, Reflection節 | 処理順、Tool境界、commit / retry | 更新する（承認後） |
| `docs/AGENT_MOTIVATION_MODEL.md` | ReflectionとConcern lifecycle | 更新する（承認後） |
| `docs/TEST_STRATEGY.md` | lifecycle / reflector別検証 | 更新する（承認後） |
| `src/domain/contracts.ts` | Concern、ReflectionのDomain契約 | 後続Issue 022、023で更新する |
| `src/application/reflection.ts` | 一括Reflection orchestration | 後続Issue 023で更新する |
| `src/application/agent-state-patch.ts` | 通常EventのConcern commit | 後続Issue 022でActivity記録を追加する |
| `src/infrastructure/persistence/*reflection*` | Session、Activity、対象別commit | 後続Issue 022、023で更新する |
| `src/infrastructure/tools/agent-context-tools.ts` | Concern履歴取得Tool | 後続Issue 022、023で更新する |
| `src/debug-ui/*` | Activity、Reflector、決定論的クローズの可視化 | 後続Issue 022、023で更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-implementation-design-v2.md` C-06, C-15, C-25 | 分割Reflection、agent的取得、Concern Activity、決定論的クローズ | 承認待ち |
| `docs/REQUIREMENTS.md` | 上記を実装要件・受け入れ条件へ展開 | 承認待ち |
| `docs/ARCHITECTURE.md` | Session、Reflector、commit、retry、Tool境界 | 承認待ち |
| `docs/AGENT_MOTIVATION_MODEL.md` | Reflectionの責務とConcern減衰 | 承認待ち |
| `docs/TEST_STRATEGY.md` | Activityと対象別処理のテスト方針 | 承認待ち |

## 設計監査（2026-11-10）

- 受け入れ条件「現行保存データと保存経路を実DBを含めて読み取り監査」は完了した。記録: `docs/work/analyze/2026-11-10-reflection-concern-activity-audit.md`。
- shiroの既存DBでは、current Concern 66件（active 53）にIDはあるが、Concern単位の作成・更新・review・最終活動の時刻・因果は保存されていない。Reflection create 77件にもRuntime採番後のConcern ID対応が残らない。
- Memory根拠Event、Memory mutation、直接観測Eventのactor / causationは部分的に利用できる。一方、Relationship履歴と対象別Reflection retry / auditは新設が必要である。
- **停止理由**: Concern Activity table、既存Concernのbaseline migration、C-15の決定論的`abandoned`移行には実質的な方針選択と一次文書の承認が必要である。推測による既存履歴の補完は行わない。
- ユーザーがbaseline方針とC-15更新を承認するまで、022 / 023を開始しない。
