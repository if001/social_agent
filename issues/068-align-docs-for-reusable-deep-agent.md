---
created_at: 2026-10-05
status: done
---

# 068: 再利用可能なDeep Agent構成に向けてdocsを整合する

## Background

Issue 067では、Bot起動時にTool一覧とDeep Agentを一度だけ構築し、Eventごとに変化するID、transport、実行上限などをrun contextで渡す方針を採用する。また、Deep Agent内部のTool loopとproviderのstructured outputを利用する。

実装前に、`spec/`を一次情報として`docs/`のAgent lifecycle、Agent Harness、Tool Registry、Tool実行context、Runtime、構造化出力に関する記述を調査する必要がある。既存docsがEventごとのAgent生成、Tool wrapper生成、自由形式JSON parse、可変Tool一覧などを前提としている場合は、Issue 067の実装方針と整合するよう修正する。docs修正後、その内容を基準にIssue 067のScope、実装メモ、完了条件、テストを再確認する。

## Scope

- `spec/personal-agent-concept-design-restructured-v2.md`と`spec/personal-agent-implementation-design-v2.md`から、Agent Core、Tool loop、Capability、Runtime、Event順序、構造化出力の設計原則を整理する
- `docs/`全体からDeep Agent、Agent Harness、Tool Registry、Tool context、Agent lifecycle、structured outputに関する記述を調査する
- Bot起動時に固定する情報と、runごとに渡す情報の境界をdocsへ明記する
- Tool一覧を`createDeepAgent({ tools })`へ起動時に渡し、同じAgentを複数Eventで再利用する構成をdocsへ反映する
- Toolを使うかどうかは各EventでAgent Coreが内部状態と文脈から判断し、固定的なAction対応表を作らないことを明記する
- run contextのID、transport、AbortSignal、実行上限、traceと、Tool引数としてLLMが生成する検索語などを区別する
- `responseFormat`によるstructured outputと、Domain固有の後段検証の責務を整理する
- 共有Agentの並行呼び出しに対するcontext分離と、同一個体のEvent順序・状態確定を区別する
- docs修正後、Issue 067がdocsと一致しているか確認し、必要ならIssue 067を修正する

## Out of scope

- Deep Agent adapter、Tool wrapper、Middleware、Runtimeのコード変更
- Memory、Intention、Long-term Candidateを応答後の別Eventへ分離する実装・設計確定
- Discord途中応答streaming
- Tool hot reload
- Long-term Review Coreの変更

## Implementation notes

- `spec/`を一次情報とし、docsからspecと異なる概念を導入しない。
- 固定するTool情報は、名称、説明、入力Schema、実装binding、Botに公開するTool集合とする。
- run contextには、Agentが生成すべきでない所有・追跡用IDとRuntime制約を置く。
- Toolの業務入力は各Toolの入力Schemaに従い、Agent CoreがTool callとして生成する。
- Agentインスタンス再利用を、会話履歴やDomain stateをDeep Agent内部へ無条件に保持することと同一視しない。永続状態の正本とContext Builderの責務を明記する。
- 修正対象候補は少なくとも`docs/ARCHITECTURE.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/REQUIREMENTS.md`、`docs/TEST_STRATEGY.md`とし、調査結果に応じて他のdocsも更新する。

## Acceptance criteria

- `docs/`内のDeep Agent生成時期、Tool登録、run context、structured outputの記述が相互に一致する
- Toolカタログの起動時固定と、各Eventでの自律的なTool選択が区別されている
- Deep Agent内部のTool loopとRuntimeの保存・配送責務が区別されている
- Deep Agentの再利用とDomain stateの永続化責務が区別されている
- 同一個体のEvent順序を維持しながら、共有Agentのcontextがrun間で混線しない方針が記載されている
- docs修正後の内容に対してIssue 067を再レビューし、必要な修正がIssue 067へ反映されている
- Issue 067のDependenciesに本Issueが先行条件として記載されている

## Tests

- `rg`でEventごとの`createDeepAgent`、可変Tool一覧、自由形式JSON parseなど旧方針の記述が残っていないか確認する
- docs内のMermaid、型例、処理順序が本文と一致することをレビューする
- Concept design §21、§22、§24およびImplementation design §26との対応を確認する
- Issue 067のScope、Out of scope、Implementation notes、Acceptance criteria、Testsをdocs修正後に再確認する

## Result

- `ARCHITECTURE.md`へBot起動時のTool変換とDeep Agent構築、run context、Middleware責務、structured response、Domain stateの正本、Event直列化を反映した。
- `REQUIREMENTS.md`へToolカタログとAgent lifecycle、run context、structured outputの要件を追加した。
- `IMPLEMENTATION_PLAN.md`と`TEST_STRATEGY.md`へIssue 067の実装・検証内容を反映した。
- `DESIGN_ALIGNMENT.md`へ調査対象と修正要否を記録した。`IMPLEMENTATION_AUDIT.md`は過去時点の監査記録であるため変更しなかった。
- docs修正後にIssue 067を再レビューし、Middleware実装責務と、前runのmessages／Domain stateを暗黙継承しない条件・テストを追加した。

## Dependencies

- Issue 021（Deep Agent内部Tool実行への統一、完了済み）
- Issue 022（Runtimeでの提案・実行記録保存、完了済み）
- Issue 065（Bot runtime標準出力log、完了済み）

Issue 067より先に完了する。

## Plan reference

- [Concept design: 基本的なAgent Loop](../spec/personal-agent-concept-design-restructured-v2.md#21-基本的なagent-loop)
- [Concept design: Toolと通常のAgent能力](../spec/personal-agent-concept-design-restructured-v2.md#22-toolと通常のagent能力)
- [Concept design: シンプルさを優先する](../spec/personal-agent-concept-design-restructured-v2.md#24-シンプルさを優先する)
- [Implementation design: Tool Loop](../spec/personal-agent-implementation-design-v2.md#26-tool-loop)
- [Issue 067: Deep Agentを起動時に構築しrun contextで再利用する](./067-reuse-deep-agent-with-run-context.md)
