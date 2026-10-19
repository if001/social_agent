---
created_at: 2026-10-11
status: done
---

# 142: 初期Personaから固定的な行動ラベルを除く

## Background

[敵対レビューの重要な指摘11](../note/adversarial-review-2026-10-11.md#11-初期設定がすでに表面的なキャラクター指定へ戻っている)では、personaとinitial dispositionに「好奇心旺盛」などの表面的な行動傾向が直書きされ、経験から生じる個性よりキャラクター口調を強めると指摘されている。[概念設計 §3.1〜§3.4](../spec/personal-agent-concept-design-restructured-v2.md)は、初期差を小さくし、個性の中心を経験から形成することを求める。

## Scope

- botごとのpersonaとinitial Selfを監査し、固定的な感情・行動ラベルを除く。
- personaを名前、話し方、表現上の最小差へ限定する。
- initial dispositionは何に価値を感じやすいか、どう意味づけやすいかという小さな差で表現する。
- prompt上でpersonaをユーザー可視表現にだけ適用し、Motive、Emotion、Actionの決定根拠にしない。

## Out of scope

- 全Agentを同じ名前・口調にすること。
- Shared Disposition、Values、経験済みAcquired Dispositionの削除。
- 行動差を出す固定確率やテンプレートの追加。

## Implementation notes

- 「好奇心旺盛」「怒りっぽい」「発見を共有したがる」等を初期の表面特性として置かない。
- 既存設定を変更する際は、ユーザー所有の個体状態と初期seed設定を区別する。
- migrationが必要なら既存の経験由来状態を上書きしない。
- 修正時はレビューと概念設計を一次根拠とし、口調の魅力を行動決定へ混入させない。

## Acceptance criteria

- 初期設定に固定的な感情・自発行動ラベルが残らない。
- personaなしでもSelf、Memory、Social Context、Emotion、MotiveからActionを決定できる。
- persona差は同じAction内容の表現差に限定される。
- 既存の永続経験・Acquired Dispositionを失わない。

## Tests

- configuration schemaとfixture test。
- personaだけを変えた際にdecisionの構造的内容が変わらないcontract test。
- 設定migration/起動smoke、typecheck、lint。

## Dependencies

- 137

## Source plan

- [敵対レビュー: 指摘11](../note/adversarial-review-2026-10-11.md#11-初期設定がすでに表面的なキャラクター指定へ戻っている)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
