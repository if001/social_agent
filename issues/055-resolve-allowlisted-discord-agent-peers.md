---
created_at: 2026-11-20
status: done
type: feature
plan: []
requirements: [FR-77, FR-82, FR-88, NFR-9, NFR-10, NFR-22]
ui: []
requires: agent
---

# 055 allowlist Bot peerをcanonical subjectとして解決する

元計画：[#052](052-design-canonical-subject-registry-for-multi-bot.md)のpeer設定・resolver・受信設計

## Background

owner humanは`user-main`へ正規化済みだが、Bot actorはsubjectに解決されず、Discord Adapterは未登録Botのmentionも受理する。許可済みpeerを`agent:<agentId>`へ解決し、Agent所有のMemory / Event subject / Relationshipに反映できるようにする。

## Dependencies

- 052

## Scope

- `config/agent-peers/<botId>.yaml`を読み、peer Agent ID、正規化表示名、Discord user IDの重複・不正項目・self参照を起動時に拒否する。channel IDの共有は許可する。
- canonical subject resolverがowner humanを`user-main`、allowlist Botを`agent:<agentId>`へ一意に解決する。
- Discord inboundが自Botへのmentionを含むallowlist Botだけを受理し、未登録BotをQueue、typing、Eventへ進めない。
- Event / Experience Integration / Memoryで、解決済みpeer actorに`agent:<agentId>` subjectを付与する。
- peerとの出来事を`self / self-guidance`として保存し、peerの視点を代理保存しない。
- Context Builderのmodel-facing actor viewから生のactor IDを除く。監査用Event / Runだけが生のactor IDを保持する。
- `agent_send`をAgent CoreのTool registryから外す。Bot間の会話・配送は`respond.peer`（056）だけが担う。

## Out of scope

- `respond.peer`による自発的peer配送（056）
- 複数の人間ユーザー
- DB registry tableの追加
- `sourceAgentId`列のmigration・削除（058）

## Implementation notes

- peerの表示名・Agent ID・Discord ID・channel IDはYAML configuration内だけで対応づける。LLM向けToolは自然言語のpeer名だけを受け、Runtimeが一意解決する。
- `memories.agent_id`が所有を分け、`memory_subjects.subject_id`が対象を分ける。peerの情報を`perspective=agent:<id>`として保存しない。
- alias migrationは#057がdry-run既定のCLIとして実装する。本Issueではmigrationを呼び出さない。
- `agent_send`は任意の内部queue宛先をLLMへ公開する旧経路であるため、互換用に保存せずTool registryから外す。内部Runtimeが将来必要とする配送は、LLM Toolとは別の非公開portで定義する。

## Acceptance criteria

- [x] AC-055-1：設定済みowner humanとallowlist Botだけを、それぞれ`user-main`と`agent:<agentId>`へRuntimeが解決する。
- [x] AC-055-2：未登録Bot、複数一致、不正設定、self参照はfail-closedとなり、Event、Memory、Relationshipを書かない。
- [x] AC-055-3：allowlist BotのmentionだけがDiscord inboundを通過する。
- [x] AC-055-4：shiro所有のpeer経験は`agent:aka` subjectを持ち、aka側のMemoryと共有しない。
- [x] AC-055-5：このIssueで追加するpeer設定・resolver・actor viewについて、LLM向けschema、Tool結果、repair payloadにcanonical ID、Discord ID、local handleが含まれない。既存Context Tool全体のID-free化は#059で行う。
- [x] AC-055-6：model-facing actor viewに生のDiscord actor IDが含まれず、Event / Run監査には生のactor IDが残る。
- [x] AC-055-7：Agent CoreのTool一覧に`agent_send`がなく、Bot会話に任意Agent IDの内部queueを使えない。

## Tests

- FR-77, FR-82：resolverとExperience Integrationがpeer subjectをRuntimeだけで付与し、Context Builder / LLM output / repair payloadをID-freeに保つことをunit / integration testで検証する。
- FR-88：allowlist Botだけがmention inboundを通り、未登録Botがtyping・queueを作らないことをDiscord adapter contract testで検証する。
- NFR-9, NFR-10：設定エラーと複数一致を起動時又は受信時にfail-closedすることをunit testで検証する。
- FR-88：`agent_send`がAgent CoreとG3 / Reflection Tool registryへ公開されないことをcontract testで検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | 実装 | peer設定、resolver、Discord inbound、subject付与 | `src/` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/config/` | peer YAMLのparse / validation | 更新する |
| `src/application/canonical-subject.ts` | peer subject resolver | 更新する |
| `src/infrastructure/ui/discord-adapter.ts` | inbound allowlist | 更新する |
| `src/application/experience-integration.ts` | peer subject付与 | 更新する |
| `src/infrastructure/persistence/postgres-experience-integration.ts` | Memory / Event subjectのcommit | 更新する |
| `src/infrastructure/persistence/postgres-agent-context-loader.ts` | model-facing actor viewからraw actor IDを除去 | 更新する |
| `src/bootstrap/bot-composition.ts` | `agent_send`のAgent Core登録を除去 | 更新する |
| `src/infrastructure/tools/agent-send-tool.ts` | 任意内部配送Toolを削除する | 削除する |
| `config/agent-peers/` | peer設定例 | 追加する |
| `tests/` | resolver、adapter、integration | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `docs/REQUIREMENTS.md` | FR-77 / FR-82 / FR-88 | 反映済み（055） |
| `docs/ARCHITECTURE.md` | ADR-20 / ADR-21 | 反映済み（055） |
