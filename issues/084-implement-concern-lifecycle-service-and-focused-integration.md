---
created_at: 2026-11-25
status: done
type: feature
plan: []
requirements: [FR-24, FR-25, FR-26, FR-41, FR-44, FR-69, FR-95, NFR-7, NFR-8, NFR-15, NFR-21, NFR-22]
ui: []
requires: agent
---

# 084 ConcernLifecycleServiceとFocus Experience Integrationを実装する

元設計：[#083](083-design-concern-lifecycle-service-and-focused-integration.md)

## Dependencies

- #083 done

## Scope

- #083で確定した`ConcernLifecycleService`を実装し、create / derive / focus / progress / status change / Reflection reconcileの永続化を共通化する。
- idle等でRuntimeが選んだFocus Concernをrun-localかつcommit済みEvent / Runの監査値として保持し、Experience Integrationへ渡す。
- Experience IntegrationがFocus Concernだけを軽量に評価し、`unchanged`、`progress`、`satisfied`、明確な`abandoned`を適用する。
- Action / Outboxの初回commit後に処理し、Experience Integrationの失敗はAction配送を巻き戻さない。
- 同じEvent / Runで既にderiveしたConcernをExperience Integrationが二重に更新しないようにする。
- Concern更新とConcern Activityを同一transactionで確定し、version / ownership / active status / evidence範囲 / idempotencyをRuntimeで検証する。

## Out of scope

- Concern landscape指標を自動のcreate / close / priority規則へ使うこと。
- active Concern数による固定quotaや、特定語の文字列一致によるclose。
- #083で確定しない要件・詳細設計の推測。

## Acceptance criteria

- [x] FR-24, FR-25：すべてのConcern writerが共通serviceを通り、Activityなしの状態変更又は二重確定を起こさない。
- [x] FR-26：idleでFocusしたConcernの行動結果がExperience Integrationへ渡る。
- [x] FR-69：concern-dueのderiveは親を維持し、同一Runの後続Integrationで重複更新されない。
- [x] FR-95：明確な満足はEvent後に` satisfied`として確定でき、検索失敗・情報不足・一時Feelingだけでは`abandoned`にならない。
- [x] FR-41, FR-44：Reflectionは横断整理と遅延closeを維持し、新規create / deriveを行わない。
- [x] NFR-8, NFR-15：Integration失敗はAction / Outboxを巻き戻さず、競合・重複は冪等なno-op又は再試行可能な失敗になる。

## Tests

- FR-24, FR-25, FR-69, FR-95：Unit / Integration testでcreate、derive、focus、progress、satisfied、abandoned、Activity監査、同一Run重複拒否を検証する。
- FR-26：System testでidleのFocus Concernを使ったExperience Integrationがprogress又はsatisfiedを確定することを検証する。
- FR-41, FR-44：Reflectionの既存Concern整理と即時Integrationの役割が重複しないことを検証する。
- NFR-7, NFR-8, NFR-15, NFR-21, NFR-22：transaction、Action失敗分離、候補1件、軽量call予算、LLMとRuntimeの判断境界を検証する。

## 実装メモ

- Agent Coreが`concern_list`と`concern_get`で関心を選ぶ。Runtimeは同一Runで最初に成功した`concern_get`をFocus Concernとして固定・監査する。`concern_history`はFocusを変更しない。
- `concern-due`は既存の`concern_due_focus`で親Concernを保持するが、deriveがcommitされたRunではExperience Integrationの即時更新対象にしない。
- `ConcernLifecycleService`はproposal、Focus / progress監査、Reflection reconcile、Experience Integration outcomeの純粋な状態遷移を共通化した。永続化層はtransaction、ownership、version、evidence、idempotencyだけを担当する。
- Experience IntegrationのFocusは`experience_integrations.input`へRuntime metadataとして保存し、retryでも復元する。モデルへはdescription / whyItMattersだけを渡し、モデルが返すのはIDなしのoutcome / reasonだけである。
- 検証：`pnpm typecheck`、`pnpm lint`、`pnpm test`（292 tests）、`pnpm test:integration`（76 tests、test DB）、`pnpm test:system`（67 tests）、`trace_check`（ERROR 0、既存WARN 8）。
