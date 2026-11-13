---
created_at: 2026-11-13
status: done
type: feature
plan: []
requirements: [FR-41, FR-42, FR-57, FR-58, FR-60, FR-72, FR-73, FR-74, NFR-7, NFR-17]
requires: agent
---

# 028 再活性化ベースのMemory Reconciliationを実装する

元計画：[Issue 026](026-design-memory-formation-and-reconciliation.md) で確定するB設計。

## Background

既存Memoryの意味は、新しい経験、Concern、Feeling、予測誤差、利用、偶発的な遠い連想によって再び想起され、局所的な関連Memory・Eventとともに再統合される。全Memoryを1件ずつ定期走査せず、再活性化selectorが選ぶ少数のアンカーまたはクラスターだけをagent的に調べる。

## Dependencies

- 026（A/B設計、Event検索RAG、Memory種別の更新規則）
- 027（Formation結果を再活性化候補へ渡す場合）

## Scope

- 有限予算の再活性化selectorを実装し、新規Formation、利用・Concern根拠、未再検討、遠い連想からアンカーMemoryまたはクラスターを選ぶ。
- Reconciliation ReflectorがToolで関連Memory・関連Eventを取得し、種別ごとに補強・訂正・分割・維持を決める。
- Eventの時系列は統合判断の根拠として保持し、古いEventによる新しい理解の巻き戻しを防ぐ。
- Reconciliationの出力・Memory mutation・再活性化理由・Tool実行・retryを監査する。
- Self / Relationship / Concern Reflectorが確定したMemoryを根拠にする既存順序を維持する。

## Out of scope

- 全Memoryの毎Session完全走査。
- episodic Memoryの内容を書き換えること。
- 通常Agent CoreのMemory検索・Background Experienceの更新。

## Acceptance criteria

- [x] FR-72：理由ごとに1件・最大4件のanchorを選び、Reflection入力はanchorだけに限定した。`memory_search` / `event_search`で局所根拠を読む。
- [x] FR-73：episodicをruntimeで拒否し、updateは後続Eventを検証する。splitは元Memoryを狭め、派生Memoryへ元Memory根拠を保存する。
- [x] FR-74：Event projection migration、保存、backfill、vector/keyword/subject/recency ranking、時刻・kind filterを追加した。
- [x] FR-41, FR-42, FR-57, FR-58, FR-60, NFR-7, NFR-17：Reconciliationをtarget別attempt・tool実行・output・mutationとして監査し、failed targetだけをretryする既存経路を維持した。

## Tests

- 追加：新規形成・利用・Concern根拠・未再検討・遠い連想からの候補選定と予算上限。
- 追加：再活性化したMemoryの関連Memory / EventをToolで取得し、入力budgetを超えない。
- 追加：Memory種別ごとのcreate / update / split / keepと、古いEventによる巻き戻し防止。
- FR-41, FR-42, FR-57, FR-58, FR-60, NFR-7, NFR-17：失敗対象だけのretryと監査の回帰。

## 実装メモ

- `event_projections` は元Eventを変更しない検索用派生データとしてmigrationでbackfillし、Runtime Event / Tool resultにも作成する。
- unit: `tests/unit/memory-reconciliation.test.ts`、`tests/unit/reflection.test.ts`。全unit 216件、typecheck、lintは成功。
- integration: migration段階適用の対象testは成功。全integrationの残る失敗は、ユーザーがdebug用に設定したReflection retry delay=0と、環境にPOSTGRES_URLがないreset testであり、本Issueで変更しない。
- 独立レビュー: `docs/work/reviews/2026-11-13-issue-028.md`。
