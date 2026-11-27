---
created_at: 2026-11-27
status: created
type: change
plan: []
requirements: [FR-48, FR-49, FR-62, FR-83, NFR-14, NFR-16, NFR-20]
requires: agent
---

# 105 G1/G2入力・出力とG3起動契約を最小化する

元計画：[G1/G2・G3 契約レビュー](../docs/work/analyze/2026-11-27-g1-g3-contract-review.md)

## Background

G1/G2は予測誤差を補助信号として扱う小さな追加callである。しかし現行契約には
`recentExperiences`、最大3候補、候補ごとの多数の評価field、`needsG3` / `targetLayers` /
`priority` が残り、Main Agentの判断を直接決めない責務に対して過剰である。

## Dependencies

- #104 完了

## Scope

- G1/G2のモデル入力を、同subjectの今回direct発話・前回Prediction・source Runの前回Action・
  限定Memoryだけへ縮小する。
- G1/G2を各layer最大1候補にし、評価を`match`、`surprise`、`interpretation`へ縮小する。
- G3起動を任意の`investigation: { reason }`だけで表し、不要時は省略する。
- 一次仕様、Requirements、prompt、repair、Context、Debug表示、testを同じ契約へ更新する。

## Out of scope

- `prediction_evaluations` relationの削除（#106）。
- 旧Prediction JSONのdata migration及びlegacy reader削除（#107）。
- G3 finding / hypothesis契約の変更。

## 差分

| 種別 | ID | 内容 | 文書 |
| --- | --- | --- | --- |
| MODIFIED | C-34〜C-38, C-50〜C-53, C-62, C-70 | 最小G1/G2入力、単一候補、最小評価、investigationを定義する | spec/prediction-error-design.md |
| MODIFIED | FR-48, FR-49, FR-62, FR-83, NFR-14, NFR-16, NFR-20 | G1/G2の入出力・Context・検証契約を同期する | docs/REQUIREMENTS.md |

## 影響範囲

検索語：`PredictionModelInput`、`PredictionCandidateBase`、`PredictionEvaluationSchema`、
`needsG3`、`targetLayers`、`predictionEvaluations`、`recentExperiences`。

| 場所 | 対応 |
| --- | --- |
| `src/domain/contracts.ts` | Prediction schemaを縮小する |
| `src/application/prediction*.ts` | 入力とG3 enqueue条件を更新する |
| `src/infrastructure/agent/prediction-harness.ts` | prompt / parser / repairを更新する |
| `src/application/context-builder.ts` | bounded prediction contextを更新する |
| `src/infrastructure/persistence/postgres-prediction-repository.ts` | 現行JSON readerを更新する。relation削除は#106へ残す |
| `src/debug-ui/*` | 縮小後のJSONを読む表示へ更新する |
| `tests/**/*prediction*` | 単一候補、最小評価、subject境界を検証する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
| --- | --- | --- |
| `spec/prediction-error-design.md` | 最小Prediction契約 | 承認済み（2026-11-27） |
| `docs/REQUIREMENTS.md` | FR-48 / FR-49 / FR-62等 | 承認済み（2026-11-27） |

## Acceptance criteria

- [ ] G1/G2のモデル入力に`recentExperiences`を含めない。
- [ ] G1/G2は各layer最大1候補、評価は`match` / `surprise` / `interpretation`だけを出力する。
- [ ] investigationのreasonがある時だけG3 Taskを作る。
- [ ] predictionContext、prompt、Debug表示、testが同一JSON契約を使う。
- [ ] 一次仕様とRequirementsに反映し、`spec-analyze`でCRITICAL / HIGHがない。

## Tests

- FR-48：同subjectの4入力以外がPrediction modelに渡らない。
- FR-49 / FR-83：1候補・最小評価・investigation契約をContract testで検証する。
- FR-62 / NFR-14：subject別predictionContextをIntegration testで検証する。
- NFR-16 / NFR-20：prompt、repair、JSON Schemaの契約を検証する。
