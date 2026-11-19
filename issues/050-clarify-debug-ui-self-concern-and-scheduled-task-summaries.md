---
created_at: 2026-11-19
status: created
type: change
plan: []
requirements: [NFR-12, FR-40]
ui: []
requires: agent
---

# 050 Debug UIのSelf・Concern・Scheduled Task概要を明確化する

元計画：Debug UIの概要表示に関するユーザー確認

## Background

「現在の Self / State」はSelfの本文を簡易表示せず、active Concernを混在させている。
Concern Activityは因果IDだけを表示し、現在のConcernの説明との対応が分からない。
また、予約タスクの`count`は全取得件数、`recent`は予約日時順の先頭8件であるが、その意味と状態別内訳が画面に表現されていない。

## Dependencies

- 047（Scheduled TaskのDebug UI表示）

## Scope

- 「現在の Self / State」の概要に`disposition`、`selfStory`、`commitments`、mood、更新時刻を表示する。
- active Concernを独立パネルへ移し、ID、description、再検討日時を表示する。
- Concern Activityの概要・詳細で、同一Stateに存在するConcernの現在のdescriptionとstatusを対応づけて表示する。
- 予約タスクを全取得件数、状態別件数、実行日時順の直近8件として明示する。
- 予約タスクの直近表示を、scheduledとcompletedを含む履歴であることが分かる名称にする。

## Out of scope

- Concern Activityへdescriptionを永続的に重複保存するschema変更
- Scheduled Taskの作成・取消・実行規則の変更
- Debug UIからの書込み操作

## Implementation notes

- Concernのdescriptionの正本はAgent Stateである。Activity表示は読み取り時にConcern IDで現在のStateと結合する。
- Scheduled Task queryは`executeAt DESC`で最大100件を取得している。`count`はこの取得集合の件数、直近表示はその先頭8件とする。

## Acceptance criteria

- [ ] AC-050-1：Self / State概要でdisposition、selfStory、commitments、mood、更新時刻を確認できる。
- [ ] AC-050-2：active ConcernがSelf / Stateから分離され、descriptionを含む独立パネルに表示される。
- [ ] AC-050-3：Concern ActivityでConcern IDに対応する現在のdescriptionとstatusを確認できる。
- [ ] AC-050-4：予約タスクで全取得件数、状態別件数、実行日時順の直近8件を区別して確認できる。
- [ ] AC-050-5：Debug UIは読取り専用であり、Agent IDで絞る既存query境界を維持する。

## Tests

- NFR-12：Self / State、active Concern、Concern Activity、Scheduled Taskの表示契約をHTML unit testで検証する。
- NFR-12：Overview queryが読取り専用・Agent所有者で絞る既存契約を維持する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | NFR-12 | 既存の読取り専用監査UIの表示構成を明確化する | 実装・テストのみ |

## 影響範囲

検索した語：`現在の Self / State`、`Concern Activity`、`予約されたタスク`、`scheduledTasks`、NFR-12。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/debug-ui/page.ts` | Overviewパネルのブラウザ表示 | 更新する |
| `src/debug-ui/repository.ts` | Overviewの読取り集合 | 変更しない。現在のStateとScheduled Taskを取得済み |
| `tests/unit/debug-ui.test.ts` | Debug UI表示・読取り契約 | 更新する |
| `docs/REQUIREMENTS.md` | 読取り専用監査の要件 | 更新しない。表示項目の具体化であり要件変更なし |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | なし。認知・永続化の意味を変えない | 不要 |
| `docs/REQUIREMENTS.md` | なし。NFR-12の読取り専用監査範囲内 | 不要 |
