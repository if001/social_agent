---
created_at: 2026-10-03
status: done
---

# 018: specを一次情報としてdocsと採用方針を整合する

## Background

通常イベントと長期Reviewの分離はspecにあるが、docsの契約・Tool Loop・評価方針が採用構成と一致するか未確認である。

## Dependencies

なし

## Scope

- spec/の2文書を一次情報としてdocs/の全Markdownを調査する。
- 通常Core、Long-term Review Core、Runtime、Deep Agent内部Tool Loopの責務を明記し、不整合のあるdocsを修正する。
- 入力・提案出力・実行記録、状態の時間スケール、Eventの振り分け、保存境界を整理する。
- 短期評価と実利用フィードバックによる長期評価を区別し、IMPLEMENTATION_PLANとTEST_STRATEGYを整合する。

## Out of scope

- コードの実装・実テスト実行
- specの無断改訂

## Implementation notes

- spec 18–26・29を重点確認する。spec 26のRuntime経由Tool Loopと内部Tool Loopの対応を説明し、実行責務と記録責務を区別する。
- specの概念・不変条件を保持する。採用構成がspecと実質的に衝突する場合は差分と解決案を明示し、未解決事項を解決済みとしない。
- 既存の未コミット変更を保持し、各docsの確認結果・根拠節・修正箇所をdocs内の整合性記録として残す。

## Acceptance criteria

- [x] docs/の全Markdownについて確認結果とspecの根拠を追跡できる。
- [x] 通常処理・長期Review・Tool実行・Runtimeの責務と出力が文書間で一致する。
- [x] 未解決の設計差分と後続Issueへの影響が明記される。

## Tests

- リンク切れと用語・型例・フロー図の相互矛盾を確認する。
- 短期状態を毎回すべて更新する記述や、固定日数による長期形成の必須ゲートが残っていないか確認する。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。
