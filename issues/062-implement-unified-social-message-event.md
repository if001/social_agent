---
created_at: 2026-11-21
status: done
type: feature
plan: []
requirements: [FR-16, FR-33, FR-47, FR-48, FR-59, FR-76, FR-77, FR-82, FR-88, FR-90, NFR-1, NFR-8, NFR-9, NFR-10, NFR-18]
ui: []
requires: agent
---

# 062 統合social message Eventとpeer相互作用を実装する

## Background

#061で確定する`message-received`を実装し、人間との会話とallowlist peerとの直接会話・観測可能な独り言を、同じ個体の社会経験として扱う。#056の自発peer mention配送は、この統合Eventと同じAction / Outbox route tableで実装するため、本Issueへ統合する。

## Dependencies

- 055
- 060
- 061

## Scope

- Domain Event contract、Runtime ingress、Context Builder、run priority、監査viewを`message-received`へ移す。既存`user-message`は過去Recordを読める互換readerだけに残し、新規writerを停止する。
- Discord ingressでallowlist peerのdirect mentionとnonmention observationを分岐し、directの二重観測を防ぐ。owner human directも同じEvent contractへ正規化する。
- interaction別skillsとmiddleware Tool policyを実装する。global system promptから人間固有の社会規則を移し、peer観測へ返信義務を与えない。
- Agent Coreの`respond`とRuntime route tableを実装する。`respond.content`のsource返信／共有発話と、任意のID-freeな`respond.peer { name, content }`のpeer mentionを、Runtimeが一意解決してOutboxへ原子的に保存する。
- Experience Integration、Memory、Relationship、Concern関連subjectをAgent所有権とinteractionに沿って更新する。peer発言をpeerの視点・確定事実として保存しない。
- Discord deliveryで現行allowlist、self、channel、metadataを再検証する。`RUNTIME_MAX_HOPS`、dedup、retry、Outbox idempotencyを維持する。
- Debug UIと監査表示で新Event名・senderKind・addressing・配送先を確認できるようにする。既存の過去traceを完全表示できなくてもよい。
- #056をsupersededとして完了処理し、重複した実装経路を残さない。

## Out of scope

- allowlist外Botとの会話
- peerごとに異なるConcern table又は別の認知loop
- Discord以外のtransport
- peer投稿を無条件に長期Memoryへ保存すること

## Acceptance criteria

- [x] AC-062-1：新規human direct、peer direct、peer observedはいずれも`message-received`として作成され、`user-message`を新規作成しない。
- [x] AC-062-2：human direct、peer direct、peer observedのmodel viewはID-freeで、skill・Tool公開・Action routeが意図どおり異なる。
- [x] AC-062-3：allowlist peer directはsource peerへmention返信でき、peer observedは共有channelへの非mention発話又は無応答を選べる。direct投稿がobservationとして二重処理されない。
- [x] AC-062-4：idle / concern-dueは共有発話に加え、Agentの動機で一意なallowlist peerへ`respond.peer`を配送できる。連投回避・応答待ちは抑制理由にしない。
- [x] AC-062-5：peerに関するMemory / Relationship / Concern関連subjectはAgent所有・agent-localであり、LLMはIDを入出力しない。
- [x] AC-062-6：allowlist外、self、曖昧名、channelなし、改竄metadata、hop超過、重複配送は外部送信しない。失敗しても他の同一transaction内で許可された配送を破壊しない。
- [x] AC-062-7：契約test・隔離DB integration test・実Discord/実LLMを使わないadapter contract testでroute table、Outbox原子性、retry / idempotencyを検証する。

## Tests

- FR-16 / FR-33 / FR-47：Eventごとのfallback、skill読込み、Tool公開／拒否をunit / contract testする。
- FR-77 / FR-82：model view、structured output、Tool result、Memory / Relationship保存に永続ID及びpeer視点が漏れないことをtestする。
- FR-76 / FR-88、NFR-8 / NFR-9 / NFR-10：ingress route、Outbox原子性、mention、共有発話、allowlist再検証、dedup、retry、hopをintegration / adapter contract testする。
- NFR-1 / NFR-18：Agent所有権とhuman direct優先をsystem testする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | 実装 | `message-received` Eventとsocial route table | `src/`, `skills/`, `tests/` |
| SUPERSEDES | 056 | 自発peer mention配送の旧実装計画 | `issues/056-*.md` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/domain/contracts.ts` | Event / Action schema | 更新する |
| `src/application/agent-runtime.ts` | ingress、priority、route、Outbox | 更新する |
| `src/infrastructure/agent/*` | Context view、prompt、middleware | 更新する |
| `src/infrastructure/ui/discord-*` | peer観測、mention配送、再検証 | 更新する |
| `src/application/*experience*` | Memory / Relationship / Concernの所有権 | 更新する |
| `skills/` | social interaction別のskill | 追加・更新する |
| `src/infrastructure/ui/debug-*` | social Event / delivery表示 | 更新する |
| `tests/` | unit / contract / isolated DB integration | 追加・更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| #061 | 要件・Architecture・skill契約 | 完了後に着手可能 |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 実装との差分がないことを確認 | #061に従う |

## 実装メモ

- 新規受信は`message-received`へ正規化し、旧`user-message`と`agent-message`はreader互換だけに残した。`senderKind`と`addressing`はモデルへ渡すが、actor・subject・transport IDは監査記録だけに残す。
- `respond.peer`は自然言語の表示名をRuntimeでallowlist peerへ一意解決し、同一Outbox transactionにDiscord mention metadataを保存する。Discord Adapterは送信時にもpeer・channelを再照合する。
- Event subjectは通常commit時に同期保存するため、direct messageのG1/G2は同一subjectのPredictionだけを前回値として読む。
- 検証: `pnpm typecheck`、変更srcのeslint、`pnpm test`（259件）、`pnpm test:system`（56件）、`pnpm test:integration`（63件）、trace check（ERROR 0）。
- レビュー: `docs/work/reviews/2026-11-21-issue-062.md`
