---
created_at: 2026-11-13
status: doing
type: change
plan: []
requirements: [FR-36, FR-37, FR-74, 追加]
requires: agent
---

# 029 Tool ResultをReflectionの経験検索から除外する

起点：ユーザーとの設計確認（2026-11-13）。`tool-result` は同一Agent loop内の観測・監査記録であり、Reflectionが検索・embeddingする経験の主単位ではない。

## Background

FR-36はTool Resultを別Interactionとして再投入しないこと、FR-37は完全なTool入出力を監査用に保持することを定める。FR-74はEvent projectionによる関連Event検索を定めるが、`tool-result` をprojection・embedding・通常検索へ含めるかを定めていない。

主Eventのsummary、assessment、action、state changeは、そのEventでTool結果をどう意味づけたかを残す。Tool結果そのものを通常のReflection検索へ含めると、主Eventとの重複、空振り・404等の過剰な再想起、Tool call数に比例するembeddingコストを生む。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-74 | Event projectionの通常検索・embedding対象を主Eventに限定し、`tool-result` を除外する | docs/REQUIREMENTS.md |
| ADDED | 追加 | Tool結果は`tool_executions`と親Eventとの因果関係を監査正本とし、必要時だけ親Eventから専用readで参照する | docs/ARCHITECTURE.md |

## 影響範囲

検索語：`tool-result`、`event_projections`、`event_search`、`FR-36`、`FR-37`、`FR-74`

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/infrastructure/persistence/event-transaction.ts` | Tool resultごとにprojectionを作成する | 除外する |
| `drizzle/0032_event_projections.sql` | 既存Eventをprojectionへbackfillする | `tool-result` を除外する |
| `scripts/backfill-event-projection-embeddings.ts` | 既存projectionをembedding化する | 念のため`tool-result`を除外する |
| `src/infrastructure/persistence/postgres-retrieval-service.ts` | Event projectionを検索する | 通常検索で`tool-result`を除外する |
| `src/infrastructure/tools/agent-context-tools.ts` | `event_search` を公開する | 主Event検索であることを明記する |
| `docs/AGENT_MOTIVATION_MODEL.md` | Event/Tool/Reflectionの関係図 | 主Eventと監査観測の境界を更新する |
| `tests/` | projection、backfill、event_search | tool-result非検索と親Event経由の監査参照を追加する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-implementation-design-v2.md` | Tool Result Eventを監査記録として保存する既存方針は維持する。Reflection検索対象からの除外は一次設計に明記されていない | 承認待ち |
| `docs/REQUIREMENTS.md` | FR-74の主Event検索対象化 | 未反映 |
| `docs/ARCHITECTURE.md` | Tool結果の監査正本と専用参照経路 | 未反映 |

## Dependencies

- 028（Event projection / Reconciliation）

## Scope

- Reflectionの通常`event_search`、projection生成、embedding backfillから`tool-result`を除外する。
- `tool_executions` と親Eventの因果監査を維持する。
- 必要時の親Event起点Tool観測参照経路を設計・実装する。

## Out of scope

- `tool-result` Event自体の廃止。
- 通常Agent loop内でTool結果を読む経路の変更。

## Acceptance criteria

- [ ] FR-74：主EventだけがReflectionのEvent projectionとembeddingの対象になる。
- [ ] FR-36, FR-37：Tool結果は同一loopと監査に残り、別Interactionにも通常Reflection検索にも投入されない。
- [ ] 追加：主Eventから必要なTool観測を明示的に参照できる。
- [ ] 差分が正の文書に反映される。
- [ ] 上流への反映がすべて反映済みまたは不要になる。

## Tests

- FR-74：tool-resultがprojection/backfill/event_searchに含まれない。
- FR-36, FR-37：Tool executionと親Eventの因果監査が保持される。
- 追加：主Eventを指定したTool観測readだけが、その子Tool結果を返す。
