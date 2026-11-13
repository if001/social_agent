---
created_at: 2026-11-13
status: done
type: change
plan: []
requirements: [FR-48, FR-62, AC-3]
requires: agent
---

# 033 Prediction互換読取りとlive DB資格情報の分離

元起点：2026-11-13のConcern Formation失敗とlive E2E失敗。

## Background

旧形式の`prediction_records.output`には、現行Schemaから削除した`remember`と
`observationCandidates`が残る。これを厳格に読み込むと、Context Loaderが
Concern Formation開始前に失敗する。live E2Eは`POSTGRES_URL`でschema作成と
migrationを行っているが、これは実行専用資格情報であり、DDLには
`ADMIN_POSTGRES_URL`を使う必要がある。

## Dependencies

- なし

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-48 | 旧Prediction形式を互換読取りし、現行形式へ正規化する。 | docs/REQUIREMENTS.md |
| MODIFIED | AC-3 | live E2EのDDLは管理用DB資格情報で行い、実行は通常資格情報で行う。 | docs/TEST_STRATEGY.md |

## 影響範囲

検索した語：`PredictionOutputSchema`、`prediction_records`、`POSTGRES_URL`、
`ADMIN_POSTGRES_URL`、`migrate(`、`production-context-user-response`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/infrastructure/persistence/postgres-prediction-repository.ts` | 保存済みPrediction読取り | 更新する |
| `scripts/` | 既存Predictionの正規化 | 追加する |
| `tests/integration/prediction-persistence.test.ts` | 旧形式読取り | 更新する |
| `tests/live/production-context-user-response.test.ts` | 隔離schemaのDDLと接続 | 更新する |
| `docs/REQUIREMENTS.md` | Predictionの互換性 | 更新する |
| `docs/TEST_STRATEGY.md` | DB資格情報の使い分け | 更新する |

## Scope

- 旧Prediction出力から廃止済みのroot fieldを除去して読取可能にする。
- 既存行を現行形式に正規化する一度限りのscriptを追加する。
- live E2Eのschema作成・migration・削除に`ADMIN_POSTGRES_URL`を使う。
- 実行時のcompositionには`POSTGRES_URL`を使う。

## Out of scope

- Prediction内容の再生成
- 通常runtimeにDDL権限を付与すること
- 既存の他形式JSONへの一般的な互換変換

## Implementation notes

- 互換読取りは廃止済みfieldだけを除去し、他のSchema不正は隠さない。
- 正規化scriptは`POSTGRES_URL`で更新する。対象tableの行更新はruntimeデータの
  保守でありDDLではない。
- live E2Eは管理Poolで専用schemaを作成・migrationし、実行Poolは同schemaを
  search pathに持つ`POSTGRES_URL`で接続する。

## Acceptance criteria

- [x] FR-48：`remember`と`observationCandidates`を含む旧PredictionがContextへ読込可能である。
- [x] FR-62：正規化後のPrediction Contextに廃止済みfieldを渡さない。
- [x] AC-3：live E2EのDDLは`ADMIN_POSTGRES_URL`、runtimeは`POSTGRES_URL`を使用する。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて不要または反映済みである。

## Tests

- FR-48：旧形式Predictionを実PostgreSQLに保存し、repositoryとContext Loaderが現行形式として読む。
- FR-62：正規化scriptが旧fieldだけを除去し、現行形式を変更しない。
- AC-3：live E2Eが管理URLで隔離schemaを作成し、実行URLで本番compositionを動かす。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | 変更なし | 不要 |
| `docs/REQUIREMENTS.md` | Prediction互換読取り | 反映済み |
| `docs/TEST_STRATEGY.md` | DDLとruntime資格情報の分離 | 反映済み |

## 実装メモ

- `PostgresPredictionRepository`は既知の廃止root fieldだけを除去してから厳格に読む。
- `prediction:normalize`はshiroの67件を正規化し、再実行では0件だった。
- live E2Eは管理接続で専用databaseを作成・migrationし、実行接続でruntimeを動かす。
- integration suite全体の同じ資格情報分離は #034 で対応する。
- 検証：`pnpm exec tsc --noEmit`、`pnpm exec vitest run tests/unit/prediction-output-compatibility.test.ts --config vitest.config.ts`、実Ollama・実PostgreSQLを用いる`production-context-user-response.test.ts`が成功した。
