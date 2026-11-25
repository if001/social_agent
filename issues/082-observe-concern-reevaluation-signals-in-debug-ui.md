---
created_at: 2026-11-24
status: done
type: feature
plan: []
requirements: [FR-24, FR-69, NFR-12]
ui: []
requires: agent
---

# 082 Debug UIでConcern再評価Eventと派生を表示する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Dependencies

- #078 done
- #079 done
- #080 done
- #081 done

## Scope

- signalは一時キューであり、Debug UIの監査対象にしない。`concern-due` Eventの発火理由、根拠範囲、derive / no-op / retryの結果を表示する。
- deriveの親子関係とActivityをConcern詳細で表示する。
- 内部思考・prompt全文・永続IDをモデル入力として扱わない既存方針を維持する。

## Acceptance criteria

- [x] AC-082-1：`concern-due` Eventごとに、発火理由・根拠範囲とderive / no-op / retryの結果を追跡できる。
- [x] AC-082-2：派生Concernの親、根拠、理由、子を読取り専用で確認できる。
- [x] AC-082-3：no-opとretryが外部発話の失敗として誤表示されない。

## Tests

- NFR-12：`concern-due`、derive、no-op、retryの表示モデルをfixtureで検証する。

## 実装メモ

- signal は未完了 work queue であり、成功時に削除される。ユーザー確認に従い Debug UI の監査対象から外し、Event と Concern Activity の永続監査値だけを表示した。
- `concern_activities` の投影へ親・子の本文、起点 Event 種別・要約を加えた。Activity は Agent ownership filter を持つ SELECT だけで読む。
- `concernLineage` / `concernDueOutcome` は fixture を用いる Unit test で derive、no-op、retry を検証する。同じ関数をブラウザ側表示へ埋め込む。
- 検証：`pnpm test`（289 tests）、`pnpm typecheck`、`pnpm lint`、Debug page script parse、`trace_check.py`（ERROR 0）。
- 分析：`docs/work/analyze/2026-11-25-change-082.md`。レビュー：`docs/work/reviews/2026-11-25-issue-082.md`。
