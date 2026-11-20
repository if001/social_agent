---
created_at: 2026-11-20
status: created
type: change
plan: []
requirements: [FR-77, NFR-8]
ui: []
requires: agent
---

# 059 Model Toolから永続Record IDを除去する

起点：#055 のFR-77実装確認

## Background

peer actorのcanonical subject解決はRuntimeへ閉じたが、既存の`concern_list`、`concern_get`、`concern_history`、`event_search`、`event_tool_results_get`などはLLMに永続Record IDを返し、後続Tool入力にも受け取る。FR-77の「LLMはIDを扱わない」に反するため、Toolを自然言語の候補・Runtime発行の局所参照・固定範囲のいずれかへ置換する必要がある。

## Dependencies

- 055

## Scope

- 全Agent Core / G3 / Reflection Toolについて、モデルに渡す入力schema、Tool結果、repair payloadに永続canonical ID、Event ID、Run ID、Concern ID、Memory ID、Discord ID、local handleが入る箇所を棚卸しする。
- 継続読み込みが必要なToolはRuntimeが発行する短命・run-scopedな局所参照へ変更し、Event / Memory / Concernの永続IDをモデルへ露出しない。
- Runtimeが局所参照を所有Agent・Event・run・期限・候補集合に照らして検証し、未解決・期限切れ・範囲外をfail-closedにする。
- Debug UIと監査Recordは永続IDを利用できるが、モデル用viewと混同しない。

## Out of scope

- `sourceAgentId`列の削除（058）
- `respond.peer`の配送（056）
- Memory / Concernの概念設計変更

## Acceptance criteria

- [ ] AC-059-1：Agent Core、G3、ReflectionのTool schema・Tool結果・repair入力に永続Record ID又はtransport identityが含まれない。
- [ ] AC-059-2：継続Tool呼出しが必要な場合も、run-scoped局所参照だけを受け、他run・他Agent・期限切れの参照では読取・更新しない。
- [ ] AC-059-3：Runtimeだけが局所参照から永続Recordを解決し、根拠・所有権・固定候補範囲を検証する。
- [ ] AC-059-4：既存Tool contract testとstructured-output/repair testが、IDを再導入すると失敗する。

## Tests

- FR-77：全Tool definition、Tool result projection、repair payloadを横断するcontract testを追加する。
- NFR-8：局所参照のcross-run / cross-agent / expiry拒否をunit testする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-77 | 永続ID非露出を全LLM Toolに適用する | `docs/REQUIREMENTS.md` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/infrastructure/tools/agent-context-tools.ts` | Concern / Event / Memory ToolのID露出 | 更新する |
| `src/application/tool-registry.ts` | Tool結果投影と局所参照の境界 | 更新する |
| `src/infrastructure/agent/*` | Core / G3 / Reflectionへのschema・repair payload | 更新する |
| `src/debug-ui/` | 監査IDの表示 | 更新しない（model-facingではない） |
| `tests/contract/`、`tests/unit/` | ID-freeと局所参照の境界 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-09に従う。一次仕様変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-77の既存文言で要求済み | 反映済み |
| `docs/ARCHITECTURE.md` | ADR-20の既存文言で設計済み | 反映済み |
