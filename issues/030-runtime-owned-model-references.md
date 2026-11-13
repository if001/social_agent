---
created_at: 2026-11-13
status: done
type: docs
plan: []
requirements: [FR-77, NFR-7]
requires: agent
---

# 030 LLM参照をRuntime所有の局所参照にする

起点：Memory Formationが範囲外のcanonical Event IDを`evidenceEventIds`へ出力し、
Reflection targetがretryable failureになった。

## Scope

- LLMが永続canonical IDを出力・生成・直接指定しない要件と設計を追加する。
- 後続の実装Issueへ、対象入力ごとの局所参照とcommit時のcanonical ID解決を引き継ぐ。

## Acceptance criteria

- [x] FR-77：LLMがcanonical IDを扱わず、Runtimeが局所参照を解決する要件を追加した。
- [x] FR-77：ArchitectureとTest Strategyへ局所参照の境界と検証を反映した。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | 実装境界の追加方針であり、概念仕様の変更なし | 不要 |
| `docs/REQUIREMENTS.md` | FR-77を追加 | 反映済み |
| `docs/ARCHITECTURE.md` | Runtime所有の局所参照解決を追加 | 反映済み |
| `docs/TEST_STRATEGY.md` | 局所参照の変換・拒否試験を追加 | 反映済み |

## Implementation notes

- 実装はIssue 031へ分離する。既存のcanonical ID出力schemaは移行対象である。
