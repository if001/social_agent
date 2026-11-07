---
created_at: 2026-11-08
status: doing
type: change
plan: []
requirements: [C-06, C-23, C-24]
requires: agent
---

# 020 永続StateとAgent Core Contextを分離する

元計画：なし（ConcernのTool取得方針とRuntime commit基準の分離）

## Background

Concern本文は初期Contextへ一括投入せず、`concern_list` / `concern_get` Toolで必要時に取得する。一方、通常EventのConcern proposalをcommitするRuntimeには、完全な永続Stateが必要である。

現在は`AgentCoreInput.state`がContext選択後の情報とRuntimeの更新基準を兼ねている。Context選択が永続Stateを加工すると、commit時に欠損させる危険がある。

## Dependencies

- 019

## Scope

- Agent Core用の選択済みContextとRuntime commit専用の完全Stateを別の入力型として扱う。
- ContextBuilderはConcern本文をAgent Core Contextへ含めない。
- Concern proposalは完全Stateを基準にRuntimeが適用・永続化する。
- 選択ContextにConcernがなくても、既存Concernを保持してproposalをcommitできる回帰テストを追加する。

## Out of scope

- Concern Toolの公開範囲やライフサイクル規則の変更。
- Agent Coreの最終出力schemaの変更。
- Reflection入力・commit経路の変更。

## Implementation notes

- `AgentCoreInput`はLLM判断用の選択済みContextとして維持する。
- 完全StateはRuntime専用であり、Agent Core promptやDebug UIの判断入力へ混在させない。
- 既存のversion検証とState全体commitは維持する。

## Acceptance criteria

- [ ] C-23：ContextBuilderがConcern本文を含まない選択済みContextを返す。
- [ ] C-06：既存active ConcernはAgent Core Contextから省かれても、次Eventのcommit後に保持される。
- [ ] C-24：Concern proposalはRuntime専用の完全Stateへ適用され、Agent Core Context由来の欠損で既存Concernを削除しない。

## Tests

- C-23：ContextBuilderのunit testでConcernが選択Contextへ含まれないことを検証する。
- C-06, C-24：PostgreSQL integration testで、Concernを含まないAgent Core Contextと完全Stateを分離して通常Eventのproposalをcommitし、既存Concernが残ることを検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-23 | 選択済みContextとRuntime専用完全Stateの分離を明文化する | `spec/personal-agent-implementation-design-v2.md` |

## 影響範囲

検索した語：`AgentCoreInput`、`ContextBuilder`、`loadInput`、`input.state`、`applyConcernProposals`、`commit`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/domain/contracts.ts` | Agent Core ContextのState表現 | 更新する |
| `src/application/agent-runtime.ts` | 完全Stateを基準にproposalを適用 | 更新する |
| `src/application/context-builder.ts` | Concernを選択Contextから除外 | 更新する |
| `src/infrastructure/persistence/postgres-agent-context-loader.ts` | 選択Contextと完全Stateの組立 | 更新する |
| `src/infrastructure/persistence/postgres-runtime-persistence.ts` | 実行入力の保存断面 | 更新する |
| `tests/unit`, `tests/integration` | 分離の回帰 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-implementation-design-v2.md` C-23 | ContextとRuntime専用完全Stateの分離 | 反映済み |
