---
created_at: 2026-11-25
status: done
type: change
plan: []
requirements: [NFR-5, FR-32]
ui: []
requires: agent
---

# 086 Graph recursion safetyをAgent予算から分離する

起点：Event `58809218-16b1-4103-aaf7-862362dc2580` で、Tool call上限内にもかかわらず、予算式から算出した `recursionLimit: 85` に到達した。

## Background

現在のGraph recursion上限は `remainingModelCalls * 2 + toolCalls + 6` で推定している。しかしLangGraphのsuperstepはモデル呼出し・Tool callと一対一対応せず、構造化出力やDeep Agent内部遷移も含む。業務予算とGraph暴走防止を同じ計算へ混在させない。

## Dependencies

- #085 done

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | NFR-5 | Tool callを最大20回、LLM callを最大22回とし、Graph safety上限を予算式から分離する。実際のGraph stepを監査可能にする。 | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-32 | 通常コードのTool call上限を20回へ更新する。 | `docs/REQUIREMENTS.md` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `docs/REQUIREMENTS.md` | NFR-5、Tool実行の最大25回 | 更新する |
| `docs/ARCHITECTURE.md` | Tool loopの最大25回、Graph safety | 更新する |
| `src/bootstrap/bot-composition.ts` | RunLimitsの初期値 | 更新する |
| `src/infrastructure/agent/deep-agent-harness.ts` | 推定recursionLimitとGraph fallback | 更新する |
| `src/infrastructure/agent/deep-agent-middleware.ts` | Model / Tool実績 | 更新する |
| `tests/contract/agent-harness.contract.test.ts` | 予算とfallbackの契約 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | 個別の実行上限は実装上の予算であり、コンセプト変更なし | 不要 |
| `docs/REQUIREMENTS.md` | NFR-5、FR-32 | 反映済み |
| `docs/ARCHITECTURE.md` | 実行予算とGraph safetyの分離 | 反映済み |

## Scope

- Main AgentのTool call上限を20回、LLM call上限を22回へ変更する。
- Graph recursion limitをモデル・Tool予算の算式から分離し、十分な固定安全上限として構成する。
- Graph step実績をRun相関ログへ残す。
- Graph safety到達後、残りのLLM予算があればToolなしの最終Action fallbackを1回だけ試す。

## Out of scope

- Reflection / G3の個別予算の変更。
- ToolやLLM callの無制限化。
- Graph safety到達後の通常探索再開。

## Acceptance criteria

- [x] NFR-5：Main AgentはTool最大20回、LLM最大22回を独立して強制する。
- [x] NFR-5：Graph recursion上限は業務予算の推定式に依存せず、実績stepをログへ残す。
- [x] NFR-5：Graph safety到達後、残余LLM予算がある場合はToolなしの最終Actionを1回試す。
- [x] FR-32：Tool上限到達は失敗結果を同一loopへ返し、既取得結果による最終Actionへ移行する。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて「反映済み」または「不要」になっている。
- [x] `spec-analyze change` でCRITICAL / HIGHがない。

## Tests

- NFR-5：22 LLM / 20 ToolのRun予算がinvokerへ渡ることを確認する。
- NFR-5：Graph recursion error後のToolなしfallbackが残余LLM予算で実行されることを確認する。
- FR-32：20回目でTool公開を停止し、追加Toolを使わず最終Actionへ移ることを確認する。

## 完了記録

- `AGENT_GRAPH_RECURSION_LIMIT`（既定256）を追加し、Main AgentのGraph safetyをTool / LLM予算の推定式から分離した。
- Main Agentの標準予算をLLM 22回、Tool 20回へ変更した。Graph callbackの`langgraph_step`を収集し、成功・失敗とも`agent_core.graph_steps`へ記録する。
- 検証: `pnpm test`（295 passed）、`pnpm typecheck`、`pnpm lint`、ID trace（ERROR 0）。
- レビュー: `docs/work/reviews/2026-11-25-issue-086.md`。
