---
created_at: 2026-10-22
status: done
type: change
plan: []
requirements: [C-01, C-02, C-11, C-12, C-17, FR-7, FR-25, FR-33, FR-43, FR-45, FR-46, NFR-4]
requires: agent
---

# 005 system promptを圧縮し、ToolとFlowの記述を整理する

元計画：なし（会話起点）

## Background

Agent Coreのsystem promptが、入力fieldの説明、判断規則、Tool呼び出し、社会基盤、ユーザー関心、返答規則の重複で肥大化していた。

- `deep-agent-prompt.ts`: 約10,751文字
- `autonomous-exploration-prompt.ts`: 約815文字
- `concern-lifecycle-prompt.ts`: 約1,557文字
- 合計: 約13,123文字

同じ制約が複数箇所にあり、モデルがどの規則を優先するか読み取りにくく、Contextとpromptの保守コストも高かった。

## Dependencies

なし

## Scope

- 3つのpromptを圧縮する。
  - 入力fieldの詳細説明を削り、根拠にできる入力と禁止事項だけ残す。
  - previousDesire、Meaning / Feeling、Mood、State Patchの規則を短い箇条書きへ統合する。
  - ToolとFlowを1節へまとめ、user-message / 自律Event / 質問前 / 将来時刻の呼び出しを明示する。
  - 社会基盤とユーザー関心の重複を統合し、深さ・質問上限・機微話題・低圧な非同期を残す。
  - 返答contentの規則を簡潔にする。
  - 自律探索とConcernライフサイクルのpromptも同じ方針で短くする。
- 圧縮後も、既存のprompt testとcontract testが要求する振る舞い・文言を維持し、AC-9のprompt長testを追加する。
- Tool公開境界とAction契約は変更しない。

## Out of scope

- Agent Coreの振る舞い、Tool集合、Action集合、Schemaの変更。
- 既存の振る舞い・要件の変更。promptの表現整理と、AC-9のprompt長要件の追加のみ。
- 新しいTool、Skill、評価scenarioの追加。
- 個体差や社会基盤の意味の変更。

## Implementation notes

- `deep-agent-prompt.ts`を、役割、判断、ToolとFlow、共通の社会基盤、返答contentの5節へ再構成する。
- 入力fieldの列挙は、実際に判断へ使う`previousAssessment`、`previousDesire`、`recentExperiences`、`runtimeConstraints`だけに絞る。
- `persona`は発話表現だけに適用し、事実・Feeling・Desireの根拠にしないことを明記する。
- `schedule_task`は実際に利用可能な場合だけ予約し、予約済みと主張しない。
- 自律Eventの`concern_list` → Focus → `concern_get` → `concern_propose`の順と、空Concern時に強制作成しない境界を維持する。
- 質問は最大1件/0件、深さは相手の開示+1段、機微話題はRelationship / Memoryの根拠が必要、という社会基盤を維持する。
- `autonomous-exploration-prompt.ts`はdeepen / bridge / distantの定義だけに絞る。
- `concern-lifecycle-prompt.ts`はactive / satisfied / abandoned / remove、再検討時刻、質問上限、機微情報の境界に絞る。

## Acceptance criteria

- [x] AC-9：3つのprompt合計が4,500文字以下になっている。
- [x] ToolとFlowが、user-messageの`self_get`、自律Eventの`concern_list` / `concern_get` / `concern_propose`、質問前の`user_context_get`、明示時刻の`schedule_task`と一致している。
- [x] 既存のprompt testとcontract testがすべて通る。
- [x] Tool集合、Action集合、Schemaを変更していない。正の文書はAC-9の追加のみ。
- [x] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- FR-7、FR-46：社会基盤、質問上限、深さ、機微話題、個体差のprompt test。
- FR-33：user-messageと自律EventのTool公開境界のtest。
- FR-43：previousDesireのprompt入力test。
- FR-45：通知とno-external-actionの通常経路test。
- FR-25、FR-44：Concernライフサイクルと強制作成の不在test。
- FR-12、FR-22：contract testで役割・入力・返答規則を確認する。
- typecheck、lint、unit、system。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | AC-9 | Agent Coreのsystem prompt合計を4,500文字以下に保つ | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`agentCoreSystemPrompt`、`autonomousExplorationPrompt`、`concernLifecyclePrompt`、`self_get`、`concern_list`、`concern_propose`、`user_context_get`、`schedule_task`

| 場所 | 内容 | 対応 |
|---|---|---|
| src/infrastructure/agent/deep-agent-prompt.ts | system prompt本体 | 圧縮する |
| src/infrastructure/agent/autonomous-exploration-prompt.ts | idle探索の説明 | 圧縮する |
| src/infrastructure/agent/concern-lifecycle-prompt.ts | Concernライフサイクル | 圧縮する |
| tests/unit/agent-prompts.test.ts | AC-9のprompt長testを追加 | 追加する |
| tests/contract/agent-harness.contract.test.ts | prompt contract | 変更しない（既存契約を維持） |
| docs/AGENT_MOTIVATION_MODEL.md | promptの意味 | 変更しない |
| docs/REQUIREMENTS.md | AC-9 | 更新する |
| docs/TEST_STRATEGY.md | AC-9の検証対応 | 更新する |
| spec/ | 一次ドキュメント | 変更しない |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md | 表現整理のみで決定変更なし | 不要 |
| spec/personal-agent-implementation-design-v2.md | 表現整理のみで決定変更なし | 不要 |
| docs/AGENT_MOTIVATION_MODEL.md | 表現整理のみで決定変更なし | 不要 |
| docs/REQUIREMENTS.md | AC-9 | 反映済み |
| docs/ARCHITECTURE.md | 表現整理のみで決定変更なし | 不要 |
| docs/TEST_STRATEGY.md | AC-9の検証対応 | 反映済み |

## 実装メモ

- prompt合計を5,753文字から4,015文字（JavaScript string length）へ圧縮した（約30%減）。
  - `deep-agent-prompt.ts`: 4,643 → 3,087文字
  - `autonomous-exploration-prompt.ts`: 427 → 348文字
  - `concern-lifecycle-prompt.ts`: 683 → 580文字
- 入力fieldの詳細列挙、判断規則、Tool呼び出し、社会基盤、返答規則の重複を統合した。
- user-messageは`self_get`のみ、自律Eventは`concern_list` → `concern_get` → 必要時`concern_propose`、質問前は`user_context_get`、明示時刻は`schedule_task`というFlowを維持した。
- 質問最大1件/0件、深さ+1段、機微話題のRelationship / Memory根拠、通知を通常会話の代替にしない境界を維持した。
- `AC-9`のprompt長testを追加した。
- テスト: `tests/unit/agent-prompts.test.ts`、`tests/contract/agent-harness.contract.test.ts`。既存の振る舞いtestは変更していない。
- 検証: typecheck、lint、unit 152件、system 42件、evaluation 14件が通過。
- レビュー記録: [docs/work/reviews/2026-10-22-issue-005.md](../docs/work/reviews/2026-10-22-issue-005.md)
