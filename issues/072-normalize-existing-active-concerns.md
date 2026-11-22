---
created_at: 2026-11-22
status: created
type: change
plan: []
requirements: [FR-8, NFR-7, NFR-8]
ui: []
requires: agent
---

# 072 既存active Concernを関心・動機の核へ正規化する

起点：akaの実DBで、旧schemaまたは境界の弱いReflectionから作られた長大なactive Concernが残り、通常のReflection入力予算から外れ得ることを確認した。

## Background

#071で新しいConcern writerは修正できるが、永続readerは通常Eventを壊さないため旧い16,000文字Concernを読み続ける。既存値は自動的には短くならず、長大なConcernはReflectionの固定入力予算から除外される可能性もある。

自然言語のConcernから、持続する関心の核とMemory・計画・履歴を分ける判断は単純な文字数や単語一致では行えない。そのため、既存active Concernを一件ずつ暗黙に束縛した軽量LLM callで`keep | normalize`し、Runtimeが元Concern IDへ適用する。

## Dependencies

- #071 done

## Scope

- `--agent-id`必須、dry-run既定、`--apply`時だけ書き込む既存Concern正規化commandを追加する。
- Agentのactive Concernを一件ずつ処理し、LLMにはIDを渡さず、現在の`description` / `whyItMatters`だけを渡す。
- 出力は`keep`、または#071の共通writer schemaに適合する`normalize { description, whyItMatters }`とする。statusと`reconsiderAt`は変更しない。
- LLMは入力にない事実・関心・動機を追加せず、持続する関心の核を保持したまま、履歴、根拠、調査結果、細かな手順、日時、配送運用、複数の独立Concernを本文から除く。独立Concernの自動分割・作成は行わない。
- Runtimeはloop中の元Concernへ暗黙に束縛し、LLMのIDを使用しない。applyはstate versionを用いた楽観ロックで全件を一transactionに反映する。
- 実際に変更したConcernごとに`concern_activities`へ`reviewed`を記録し、command run IDと時刻をRuntimeが付与する。LLMは監査IDを出力しない。
- 一件のprovider / schema失敗でapplyせず、dry-run結果に失敗対象を表示する。再実行可能にする。
- #071完了後、実DBのakaにdry-runし、結果を確認してから`--apply`し、active Concernが共通writer schemaに適合することを確認する。

## Out of scope

- satisfied / abandoned Concernの書換え
- Concernの作成、分割、終了、reconsiderAt変更
- Memory、Commitment、Relationship、Scheduled Taskの新規作成・削除
- DB schema変更または手書きmigration SQL

## Implementation notes

- 公開テストseamは、正規化serviceのmodel / repository portとCLI引数契約。実LLM・実DB確認は適用前のdry-runと適用後のread-backで行う。
- 軽量LLM callはactive Concern件数分であり、数百回未満の上限内とする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-8 | 旧Concernを意味を保ってwriter契約へ収束させる保守経路を追加する | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-7 | 既存Concern正規化をConcern Activityとして監査する | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-8 | dry-run、明示apply、楽観ロック、原子的更新を要求する | `docs/REQUIREMENTS.md` |

## 影響範囲

検索した語：`agent_states.concerns`、`ConcernSchema`、`concern_activities`、`reviewed`、`state version`、`--agent-id`

| 場所 | 内容 | 対応 |
|---|---|---|
| `docs/REQUIREMENTS.md` FR-8 / NFR-7 / NFR-8 | 既存データの収束・監査・適用境界 | commandの契約を追記する |
| `src/application/` | 正規化service / ports | 追加する |
| `src/infrastructure/agent/` | 軽量構造出力model | 追加する |
| `src/infrastructure/persistence/` | Concern読取り・楽観ロック更新・activity監査 | repositoryとして追加する |
| `scripts/`、`package.json` | dry-run / apply command | 追加する |
| `tests/unit/` | keep / normalize / failure / ID非公開 | 追加する |
| `tests/integration/` | transaction、version conflict、activity | test DBで追加する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | 既存データを現行C-06へ収束させる保守実装であり変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-8 / NFR-7 / NFR-8へ保守経路を追記 | #071完了後に反映する |

## Acceptance criteria

- [ ] AC-072-1：dry-run既定でactive Concernを一件ずつ`keep | normalize`し、LLMに永続IDを渡さない。
- [ ] AC-072-2：`--apply`は全正規化をversion付きtransactionで反映し、失敗時は一件も更新しない。
- [ ] AC-072-3：statusとreconsiderAtを維持し、変更ConcernへRuntime所有の`reviewed` Activityを残す。
- [ ] AC-072-4：実DBのakaでdry-runとapply後read-backを行い、active Concernが#071のwriter契約へ収束する。
- [ ] AC-072-5：差分が正の文書へ反映され、上流への反映が反映済み又は不要で、`spec-analyze change`にCRITICAL / HIGHがない。

## Tests

- FR-8：一件ずつ暗黙に束縛し、関心の核を維持するkeep / normalizeを適用するunit test。
- FR-8：model-facing input / outputにID、status、reconsiderAtを含めないcontract test。
- NFR-8：dry-runは書き込まず、applyはversion conflictまたは一件の失敗で全件rollbackするintegration test。
- NFR-7：変更ConcernだけにRuntime生成のreviewed Activityが保存されるintegration test。
