---
created_at: 2026-11-24
status: done
type: feature
plan: []
requirements: [FR-8, FR-24, FR-69, FR-76]
ui: []
requires: agent
---

# 079 新しい経験からConcernを派生させる限定lifecycle loopを実装する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Dependencies

- #078 done

## Scope

- trigger Memory / external changeから、subject・時刻・embedding・keywordでactive ConcernをHybrid Retrievalする。
- ID-free viewと限定read-only Toolを使う`concern-due` lifecycle loopを実装する。
- 出力を「derive proposal 0..N」と任意の通常Actionへ限定し、親Concernのupdate / status変更 / replaceをRuntimeで拒否する。
- 現在の具体的Desireがある時だけ発話し、それ以外は`no-external-action`で完了する。

## 実装詳細

- `concerns` は本文由来の検索用embeddingを保持する。signal Memoryのsubject・時刻を候補範囲に使い、embedding類似度とkeyword一致を合わせてactive Concernを順位付けする。
- `concern_due_focus` は順位付き候補から1件だけを返すread-only Toolである。モデルにはConcern本文、重要性、signal Memoryの自然言語viewだけを返し、Concern ID・候補番号・cursorは返さない。
- RuntimeはTool結果の内部Concern IDをRun-localに保持する。`derive`は直前に取得したfocusへだけ紐付き、focusなしのderiveは拒否する。モデルの`concern_propose`入力・出力にはsource IDを含めない。
- 同一signalで既にfocusしたConcernは次の`concern_due_focus`候補から外す。derive proposalはRuntimeが親の所有権・active状態・重複を検査してcommitする。

## Out of scope

- Concern系譜の永続schema（#080）
- Reflectionの整理（#081）

## Acceptance criteria

- [x] AC-079-1：関連Concern候補だけがID-freeでモデルへ渡る。`tests/system/tool-loop.test.ts` の Runtime focus / model ID非露出検証。
- [x] AC-079-2：根拠経験から別の持続的関心が生じた時だけderive proposalをcommitできる。`concern-due` skillの分離基準と、Runtime-resolved proposalのsystem test、Concern embedding integration testで検証。
- [x] AC-079-3：親Concernのreplace・更新・終了、過去予定の実行、発話のみを目的とするRunを拒否する。`tests/system/tool-loop.test.ts` のroute / focus必須検証。
- [x] AC-079-4：発話が必要なDesireだけ配送され、no-opは監査付きで成功する。既存 `tests/system/observation-gate.test.ts` のFR-76 coverageを維持。

## Tests

- FR-69：同一Concernの詳細化だけではderiveされず、別の持続的関心だけがforkされる。
- FR-69：親Concernのstatus / 本文がconcern-dueで変更されない。
- FR-76：具体的DesireなしではOutboxを作らず、no-external-actionで完了する。

## 実装メモ

- `concerns` に検索専用embeddingと状態を追加した。canonicalなConcern本文は複製せず、作成・派生commit後にembeddingし、既存未index行は `pnpm concern:embed:migrate -- --agent-id <id>` でbackfillする。
- `concern_due_focus` はRuntime内部のIDをRun-local collectorにだけ保存し、モデル返却値は `toModelRecordView` でIDを除去する。`derive`はfocusなし・親ID指定ともに拒否する。
- Drizzle migration `0050_burly_newton_destine` は生成物である。migration接続の`search_path`に`app`を追加し、`app.vector`型を解決する。
- 検証: `pnpm run db:generate`、`pnpm run db:migrate:test`、`pnpm run test:integration`（73 passed）、`pnpm run test:system`（67 passed）、`pnpm run typecheck`、対象ESLint、`git diff --check`。
- 変更分析: `docs/work/analyze/2026-11-24-change-079.md`。レビュー: `docs/work/reviews/2026-11-24-issue-079.md`。
