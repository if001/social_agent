---
created_at: 2026-11-21
status: done
type: change
plan: []
requirements: [FR-1, FR-2, FR-76, FR-77, FR-82, FR-88, FR-90, NFR-3, NFR-8, NFR-9, NFR-10, NFR-21]
ui: []
requires: agent
---

# 066 通常 peer 投稿を軽量 Observation Gate で選別する

## Background

allowlist peer の非mention投稿は、現在はすべて`message-received/peer/observed`として
Agent Coreへ入る。投稿を観測すること自体は必要だが、毎回Deep Agentを起動すると、
無関係な投稿にも通常会話と同じLLM・Tool・Experience Integrationのコストを払う。

観測した投稿を後で必ず拾う`defer`状態は持たない。今回は、Agent自身にとって
気になる投稿だけを通常Loopへ渡し、気にならない投稿は監査用Eventとして残す二値にする。

## Dependencies

- 062
- 063
- 065

## Scope

- `peer/observed`だけの前段に、`ignore | engage`を返す軽量 Observation Gate を置く。
- Gateは、投稿本文、自然言語のpeer名、現在の相手Relationship、少数の関連Memoryと
  active Concernを、厳しく上限を設けたID-free viewで判断材料にする。
- `ignore`では不変の監査EventとGate判断だけを永続化し、Agent Core、Tool、Outbox、
  Experience Integration、Event Projection、Reflection/RAG対象を作らない。
- `engage`だけを既存の`message-received/peer/observed` Agent Core経路へ一度だけ通す。
- direct human / peer、allowlist、配送route、hop、subject所有権の既存契約は変えない。
- Gateのprovider失敗時は投稿を黙って捨てず、`engage`へfail-openする。失敗理由は監査する。
- Debug UIのEvent詳細とタイムラインで、観測投稿のGate判断を区別して表示する。
- Requirements、Architecture、Event overview、用語、test strategy、schema descriptionを
  二値Gateと監査・検索除外の契約へ更新する。

## Out of scope

- `defer`、後続idle/Reflectionでの再判定queue、または第三の状態
- human/direct又はpeer/directの前段選別
- allowlist外Botの受理
- peer別のConcernや別の認知pipeline
- 投稿本文を無条件にMemoryへ保存すること

## Acceptance criteria

- [x] AC-066-1：allowlist peerのnonmention投稿は、ID-freeかつ小さい入力のGateで
  `ignore`又は`engage`へ一度だけ分類される。
- [x] AC-066-2：`ignore`は監査EventとGate判断だけを残し、Agent Core、Tool、Outbox、
  Experience Integration、projection、Reflection/RAGの候補を作らない。
- [x] AC-066-3：`engage`は既存の`peer/observed` Agent Coreと配送routeを変えずに通る。
- [x] AC-066-4：direct投稿はGateを通らず、既存どおり優先して通常Loopへ入る。
- [x] AC-066-5：Gate provider失敗は監査したうえで`engage`へfallbackし、投稿を黙って失わない。
- [x] AC-066-6：Debug UIとRepository queryはGate decisionを表示でき、`ignore`を
  Reflection・Event Retrievalから除外する。

## Tests

- FR-1 / FR-2 / FR-88：directのbypass、observedの一回だけのGateとengage経路をRuntime / Adapter contract testする。
- FR-77 / NFR-3：Gateのmodel viewに永続ID・transport metadataを含めず、件数・文字数予算を検証する。
- FR-76 / FR-82 / FR-90：ignoreが発話・Experience・Memory・Relationshipを生まず、engageだけが既存social routeを維持することをsystem testする。
- NFR-8 / NFR-9 / NFR-10：Gate判断とEvent監査をatomicに保存し、failure時のfail-openと重複実行防止をintegration testする。
- NFR-21：GateのLLM / RAG query数、token、失敗をRun外のGate監査として計測・上限検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-1, FR-2 | observed peerだけが軽量Gateを経由して通常Loopへ入ることを明記する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-76, FR-88, FR-90 | 二値Gate、ignoreの非発話・非経験化、direct bypassを明記する | `docs/REQUIREMENTS.md` |
| ADDED | FR-91 | Gate入力、fail-open、監査、検索除外、予算を定義する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-16, ADR-21 | priorityとsocial ingressをGateを含む構造へ更新する | `docs/ARCHITECTURE.md` |
| MODIFIED | Event overview | observed Eventの前段Gateと`ignore`の扱いを追加する | `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` |
| MODIFIED | Test Strategy | Gateのcontract / integration / system検証を追加する | `docs/TEST_STRATEGY.md` |

## 影響範囲

検索した語：`message-received`、`peer/observed`、`respond.observedReply`、
`Experience Integration`、`event_projections`、`Reflection`、`Debug UI`

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/application/agent-runtime.ts` | observed ingressのGate、ignore監査、engageへの引継ぎ | 更新する |
| `src/bootstrap/*` | Gate provider / repositoryのcomposition | 更新する |
| `src/domain/*` | Gate contractとID-free model view | 更新する |
| `src/infrastructure/agent/*` | bounded structured Gate model | 追加又は更新する |
| `src/infrastructure/persistence/schema.ts` | Gate decision監査schema | 更新する |
| `src/infrastructure/persistence/*repository*` | Gate監査、ignore除外、Debug query | 更新する |
| `src/infrastructure/ui/debug-*` | Gate decision表示 | 更新する |
| `skills/social-message/SKILL.md` | Gate通過後だけのpeer観測方針を明記 | 更新する |
| `tests/*` | Gate境界、永続化、検索除外、UI view | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-16 / C-17の実行予算とEvent詳細化であり変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-1 / FR-2 / FR-76 / FR-88 / FR-90とFR-91 | 反映済み |
| `docs/ARCHITECTURE.md` | ADR-16 / ADR-21 | 反映済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | observed Gateの図と表 | 反映済み |
| `docs/TEST_STRATEGY.md` | Gateの検証方針 | 反映済み |

## 実装メモ

- `observation_gate_decisions`はGateのID-free入力、判断、失敗理由、LLM/RAG call数をEventに一対一で監査する。`ignore`はRunを作らず、Context・Reflectionの双方から除外する。
- observed peer投稿はDB receiptを`gate-processing`として先に予約する。予約失敗はGateを実行せず、通常Loop失敗時だけ予約を解放して既存の再試行を維持する。
- テストDBの既存0040 ledger不整合は、0040後schemaを検証してledgerのみ補正する専用scriptで修復し、その後のmigrationはDrizzle Kitで適用する。
- 検証：`pnpm typecheck`、`pnpm lint`、`pnpm test:system`（59 tests）、`pnpm test:integration`（64 tests）、`trace_check.py`（ERROR 0）。
- レビュー：`docs/work/reviews/2026-11-21-issue-066.md`。指摘されたReflection除外、失敗監査、重複Gate、UI表示、call数監査を修正済み。
