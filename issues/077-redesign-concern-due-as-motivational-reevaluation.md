---
created_at: 2026-11-24
status: done
type: change
plan: []
requirements: [FR-8, FR-24, FR-25, FR-39, FR-41, FR-44, FR-66, FR-67, FR-69, FR-76, NFR-6]
ui: []
requires: agent
---

# 077 Concern lifecycle の Event 境界を再設計する

## Goal

Concernを期限付きTaskではなく、複数Eventに残る関心・動機として扱う。`concern-formation`、`concern-due`、Reflection、idleが重複せず協調し、経験がConcernを生み、分岐させ、整理し、行動へ接続できるようにする。

2026-11-24にshiroの実DBで確認した、期限超過Concernごとの`concern-due`が短時間に連続実行され、古い予定を通常Agent Loopで実行・発話しようとする挙動を解消する。

## 採用済みの責務境界

| Event | Concern操作 | 責務 | 非責務 |
|---|---|---|---|
| `concern-formation` | `create` | Self / Memory / Relationship / Background Experience / exploration domainから、独立した持続的Concernを形成する | 既存Concernの派生・整理、外部発話 |
| `idle` | 既存Concernの消化、例外的な`create` | 現在のConcernを選び、自身の好奇心・感情・意志で探索・発話・質問する | Concern数を維持するためのcreate、Concernの定期整理 |
| `concern-due` | `derive + fork` | 新しい関連Memory又は外部変化を契機に、既存Concernから別の持続的関心が分かれたかを検討する | 親Concernの更新・終了、過去の予定の実行、Web探索の完遂、独立Concernの幅作り |
| Reflection | 整理 | 既存Concernを統合・具体化・満足・放棄する | 新規Concernのcreate・derive、日常的Concern消化、外部探索 |

`concern-due`は発話必須ではない。派生検討の結果に、現在の具体的Desireが生じた場合だけ発話できる。派生だけ又はno-opなら`no-external-action`で成功する。

## 確定した詳細設計

### Triggerとcoalesce

- `reconsiderAt`とConcernごとの`concern-due` scheduleを廃止する。時刻だけでは、Concernを見直すべき意味のある新情報にならない。
- Conversation Memoryのcreate / update / split又は明示的なexternal-changeが、関連Concernの再評価signalを起こす。
- RuntimeはsignalをAgent単位にcoalesceする。複数Memory更新や複数候補があっても、Concernごとの通常Agent Runや個別retryに分けない。
- retryはsignal単位で冪等に行う。成功後に翌日へ自動再予約しない。再起動時も未完signalだけを復元する。

### 候補と根拠

- Runtimeは新しいMemory / external changeのsubject、時刻、embedding、keywordを使い、active ConcernをHybrid Retrievalで候補化する。
- 候補ごとに、Concernの本文・whyItMatters、triggerとなった経験、Concern作成又は最後の意味Activity以後の関連Memory / Eventを小さく取得する。
- LLMは候補の自然言語viewだけを読み、別の持続的な関心が生じたかを判断する。永続IDや局所参照を入力・出力しない。
- Runtimeが候補範囲、所有権、時系列、重複、ID対応、transaction、signal完了を決定論的に扱う。

### 派生と監査

- deriveは「親Concernと同じ研究ノートを詳細化する」ことではない。親の関心から、別の問い・対象・方法として今後も残る関心が分岐した時だけ新しいConcernを作る。
- parentはactiveのまま残す。`replace`、親の`status`変更、親本文の更新は`concern-due`で禁止する。
- `concern_activities`に`source_concern_id`を追加し、derive Activityが親Concernを参照する。Activityにはtrigger Event / Memory根拠、派生理由、子Concernを監査可能に残す。Concern表に親IDを複製しない。
- LLMは「派生すべきか」「子Concernの関心核・重要性・理由」だけを出す。Runtimeが候補親へ対応付け、重複候補をcommitしない。

### Reflectionとの協調

- ReflectionはMemory Formation / Reconciliationの後、既存Concernだけを横断して整理する。
- Reflectionは似たConcernを統合し、本文を関心核へ正規化し、現在価値を失ったConcernをsatisfied / abandonedにできる。新規Concernを作らない。
- stale closeはReflectionの既存Activityとsession内のreview結果だけを使う。future `reconsiderAt`は除外条件にしない。

## 必要な後続実装Issue

1. `reconsider_at` とConcern単位scheduleを削除し、Agent単位のcoalesced signalへ置換する。既存値・scheduleを安全に削除するmigrationを含める。
2. Memory update / external-changeから関連ConcernをHybrid Retrievalで候補化し、限定lifecycle loopを実装する。発話は任意にする。
3. `concern_activities.source_concern_id`、derive監査、親を置換しないRuntime検証を追加する。
4. Reflectionから新規Concern作成を除き、既存Concern整理だけへ縮小する。
5. Debug UIへsignal、候補、根拠範囲、派生、親子関係、no-op、retryを表示する。

## 一次文書への反映

| 文書 | 反映 |
|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` C-06 / C-17 | `reconsiderAt`を削除し、作成・派生・整理・発話の境界を更新済み |
| `docs/REQUIREMENTS.md` | FR-8、24、25、44、66、67、69、76、AC-6、AC-21を更新済み |
| `docs/AGENT_MOTIVATION_MODEL.md` | Event起点とConcern lifecycle図を更新済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | Event責務・発話区分・Reflection責務を更新済み |

## Acceptance criteria

- [x] AC-077-1：Concernを作る・派生させる・整理する・行動へ使うEventの責務と非責務を分離した。
- [x] AC-077-2：`reconsiderAt`を廃止し、新しいMemory / external changeを`concern-due`の契機と定義した。
- [x] AC-077-3：Agent単位coalesced signal、候補取得、ID非露出、retry、再起動の責務を定義した。
- [x] AC-077-4：deriveの意味、親を置換しない規則、Concern Activityに残す系譜を定義した。
- [x] AC-077-5：Reflectionを既存Concernの整理だけへ限定した。
- [x] AC-077-6：一次仕様・要件・関係図を採用方針へ更新した。
- [x] AC-077-7：後続実装Issueを、schema/migration、signal/runtime、Reflection、Debug UIとテストへ分割した（#078〜#082）。

## 実装メモ

このIssueは要件・設計整合を完了した。実装は上記の後続Issueで行う。既存の`reconsider_at`列、Concern schedule、Reflection createの実装は、このIssueの設計だけでは変更しない。

照合記録：`docs/work/analyze/2026-11-24-change-077.md`
