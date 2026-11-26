# 分析レポート：change（2026-11-26）

## 対象

| 項目 | 内容 |
|---|---|
| 段階 | change |
| 基準 | `spec/personal-agent-concept-design-restructured-v2.md`、`docs/REQUIREMENTS.md`（FR-65、NFR-23、AC-24） |
| 照合した成果物 | 構造化LLM出力の全Harness、共通parser、評価用Ollama client、関連Unit test |
| 対象のコミット | `b2c868f5` |

## 要約

| 重大度 | 件数 |
|---|---:|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

機械検査：ERROR 0 件 / WARN 8 件 / INFO 33 件

## 結果

- JSON code fenceは許可されたpresentation wrapperとして、`parseJsonOutput`が一律に外した後だけJSON.parseする。無指定のcode fence、YAML、`key: value`、自由文、文字列内の生の制御文字は受理しない。
- 通常OllamaのConcern impact、G1/G2、Experience Integration、Event Experience repair、Concern正規化、Web要約、Observation Gateの構造化出力は、共通parserとJSON Schemaを使う。初回promptもJSON objectを明示する。
- Web要約にあった`summary: ...`フォールバックは削除した。
- MainAgent、G3、Reflectionは`toolStrategy(modelJsonSchema(...))`の構造化出力Tool argumentsだけを最終出力にするため、同じJSON契約を満たす。
- `action`文字列の既存schema recoveryは、JSON objectを受けた後のschema repairであり、今回定義したJSON形式の境界とは別の契約として残す。
- parserとpromptのContract testを追加し、JSON code fenceの許容とYAML・自由文・壊れたJSONの拒否を検証した。

## 機械検査の結果

`trace_check.py` は ERROR 0 件。WARN 8 件（FR-64、FR-70、FR-74、FR-75、FR-85、FR-89、FR-93）は既存の要件トレーサビリティ不足であり、本変更の対象外。AC-24は新しいtest参照を検出しており、NFR-23のINFOは追加要件として一次文書へ反映候補であることだけを示す。
