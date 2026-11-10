---
created_at: 2026-11-10
status: created
type: change
plan: []
requirements: [FR-25, FR-69, NFR-7, NFR-17, 追加]
requires: agent
---

# 022 Concern Activityを記録し、長期未処理Concernを決定論的に閉じる

元計画：なし（Issue 021で承認するConcern lifecycle設計）

## Background

Concernの現在Stateだけでは、作成・進展・レビュー・派生・status変更の時刻と因果をConcern単位に取得できない。agent的なConcern取得と、十分に扱われなかったConcernの決定論的クローズには、commit層が生成する最小のConcern Activityが必要である。

## Dependencies

- 021（保存経路監査、上流設計、migration baseline方針が反映済み）
- 020（完全StateとLLM選択Contextの分離）

## Scope

- Concern ActivityのDB schema、Domain契約、repository、監査表示を追加する。
- 通常Runtimeのcreate / derive / replace、Reflectionのcreate / upsert / remove、決定論的closeでActivityを原子的に記録する。
- `concern_list`、`concern_get`、Concern履歴・関連根拠取得Toolを、短い一覧と必要時の詳細に分ける。
- stale条件とSession終端時の未処理ConcernをRuntimeが`abandoned`へ移す処理を実装する。
- 既存Concernには、migration時刻を観測基準としてActivityを初期化する。

## Out of scope

- 分割ReflectionのLLM orchestrator自体の実装（023）。
- Concernの自由文をタスク管理用の多数fieldへ分解すること。
- `dormant` statusの追加。

## Implementation notes

- 021の設計監査で、既存記録からConcern lifecycleを十分に復元できるか、Activity tableとbaseline migrationが必要かを確定してから実装する。監査が方針変更を示した場合はユーザー承認まで開始しない。
- ActivityはConcern JSONではなく専用監査記録に置く。必要な値はConcern ID、activity kind、occurredAt、Event / Run / Reflection ID、根拠Memory IDだけとする。
- 時刻とActivity kindはRuntime / repositoryが付与する。LLMはActivityの時刻・IDを生成しない。
- staleクローズは`CONCERN_STALE_AFTER_MS`（既定30日）と`CONCERN_STALE_MIN_REFLECTION_SESSIONS`（既定2）および除外条件を満たすactive Concernだけに適用し、必ずState changeとActivityを残す。設定parseと`.env.sample`もこのIssueで追加する。
- Concern取得Toolは全active Concernをページング可能にし、stale順・最近進展順などの表示はActivityから導出する。

## Acceptance criteria

- [ ] FR-25：Concernごとの作成、進展、レビュー、派生、status変更を監査可能にする。
- [ ] FR-69：Concern再評価が必要な履歴・関連根拠をToolで取得できる。
- [ ] 追加：stale期間を超え、同一Reflection Sessionで維持・進展・派生・レビューされなかったConcernを決定論的に`abandoned`へ変更する。
- [ ] NFR-7, NFR-17：Activityとクローズはretryで重複確定せず、Debug UIから因果を追跡できる。

## Tests

- FR-25：通常RuntimeとReflectionがConcern変更と同じtransactionでActivityを記録するintegration test。
- FR-69：Concern履歴Toolが別AgentのActivityを返さず、ページング・順序・関連根拠を検証するunit / integration test。
- 追加：stale対象が明示的に扱われなければ`abandoned`になり、future `reconsiderAt`または明示的レビュー済みConcernは維持されるintegration test。
- NFR-7, NFR-17：retry時にActivityとクローズが重複しないintegration test。

## 差分

Issue 021で承認するFR / AC / ADRに従う。一次文書の変更はこのIssueでは行わない。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/domain/contracts.ts` | Concern Activity、close契約 | 更新する |
| `src/application/agent-state-patch.ts` | 通常EventのConcern差分 | 更新する |
| `src/application/scheduler.ts` | stale review / closeの起動 | 更新する |
| `src/infrastructure/persistence/schema.ts` | Activity table | 更新する |
| `src/infrastructure/persistence/event-transaction.ts` | Runtime commitとActivityの原子性 | 更新する |
| `src/infrastructure/persistence/postgres-reflection.ts` | Reflection Concern変更のActivity | 更新する |
| `src/infrastructure/tools/agent-context-tools.ts` | Concern読み取りTool | 更新する |
| `src/debug-ui/*` | lifecycleとclose表示 | 更新する |
| `tests/unit`, `tests/integration` | lifecycle、冪等性、所有権 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| Issue 021 | Concern Activityと決定論的クローズ設計 | 反映済み |
