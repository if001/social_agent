---
created_at: 2026-10-09
status: done
---

# 104: Selfと動機・行動の関係図を作成する

## Background

Self Interest、Preference、Drive、Desire、Current Interest、Intentionは持続時間と責務が異なる。Selfが何を保持し、各要素が意味づけ、状態、行動、経験による長期更新へどう影響するかを俯瞰できる文書が必要である。

## Dependencies

- Issue 103

## Scope

- Selfが持つ比較的安定した要素を整理する
- 短期・中期・長期状態と更新担当を整理する
- 各要素の主な影響関係をMermaidで図示する
- Current InterestとIntentionの違いを例示する
- 経験とLong-term Reviewによる個体化の循環を図示する

## Out of scope

- 新しい状態SchemaやRuntime処理の追加
- 状態間の固定変換規則
- UI実装

## Implementation notes

- `spec/`を一次情報とし、現在の`docs/REQUIREMENTS.md`と`docs/ARCHITECTURE.md`の用語に合わせる。
- 矢印は影響可能性を表し、Self InterestからDriveなどを必ず生成する規則として表現しない。

## Acceptance criteria

- Self、持続状態、Event内状態、行動、Memory、Long-term Reviewの関係を確認できる
- Self Interest、Preference、Drive、Current Interest、Desire、Intentionの違いを比較できる
- Mermaid対応Markdown viewerで図を表示できる構文になっている

## Tests

- MarkdownとMermaid blockの目視確認
- `pnpm lint`

## References

- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
