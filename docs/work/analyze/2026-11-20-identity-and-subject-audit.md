# 分析レポート：impl（2026-11-20）

## 対象

| 項目 | 内容 |
|---|---|
| 段階 | impl |
| 基準 | `spec/personal-agent-concept-design-restructured-v2.md` C-09、`docs/REQUIREMENTS.md` FR-77、FR-82、FR-88 |
| 照合した成果物 | canonical subject、Discord adapter、Agent Runtime、Memory / Reflection persistence、peer config |
| 対象のコミット | `07a61db09391fcf4b2a17d7e113e99d42f96fbac` |

## 要約

| 重大度 | 件数 |
|---|---:|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 1 |
| LOW | 0 |

静的監査である。DB recordの孤立件数は実DBを読まずには判定できない。

## 指摘

| # | 重大度 | 観点 | 内容 | 根拠 | 直す側の候補 |
|---|---|---|---|---|---|
| 1 | HIGH | C | `config/agent-peers/*.yaml`は存在するが、runtimeは読み込まない。canonical resolverはowner humanだけを`user-main`へ解決し、Discord Adapterは自己以外の全Botを受理する。そのため`agent:aka` / `agent:shiro`はEvent subject、Memory subject、Relationshipへ到達しない。 | `src/application/canonical-subject.ts`、`src/infrastructure/ui/discord-adapter.ts`、`src/config/config.ts`、FR-82、FR-88 | 実装（#055） |
| 2 | HIGH | A/C | Reflection Memory schemaが`subjects`と`source`をLLMの入出力IDとして許し、旧commit経路がその値を`memory_subjects.subject_id`と`memories.source_agent_id`へそのまま書く。前者はcanonical subjectを偽造でき、後者は「情報源ID」とAgent IDを混同する。FR-77のRuntime-only ID解決に反する。 | `src/infrastructure/agent/reflection-harness.ts:16-22`、`src/infrastructure/persistence/postgres-reflection.ts:224-264`、FR-77 | 実装。要件変更は不要 |
| 3 | HIGH | C/D | raw actor IDが現在ObservationとRecent Experienceのmodel-facing inputへ残る。peer設定のraw Discord IDも、実装後このままではLLMが読む。さらに`agent_send`は任意の`destinationAgentId`へ内部配送し、受信側の`senderAgentId`をagent actorとして保存するため、allowlist / canonical resolverを迂回する。 | `src/infrastructure/persistence/postgres-agent-context-loader.ts:81-100`、`src/infrastructure/tools/agent-send-tool.ts`、FR-77、FR-88 | 実装（#055、#056の範囲再確認） |
| 4 | HIGH | D | `sourceAgentId`はAgent IDとして読める名前・domain schemaだが、DB FKもallowlist検証もなく、通常Event経路では設定されない。Reflectionだけが任意の情報源文字列を渡す。Memory subjectが対象を表す設計に対し、sourceAgentIdは「誰について」でも「所有Agent」でもない曖昧な第三の識別子になっている。 | `src/domain/contracts.ts:250-256`、`src/infrastructure/persistence/schema.ts:15,21`、`src/infrastructure/persistence/postgres-reflection.ts:101,228` | 設計判断後に実装。保持するなら`sourceDescriptor`へ改名し自然言語化、Agentを表すならcanonical peer resolverで検証 |
| 5 | MEDIUM | C/D | `scheduled_tasks.destination`と`agent_send.destinationAgentId`は任意文字列のtransport宛先であり、subject / peer allowlistとは別物である。この区別がschema・Tool descriptionで明確でなく、将来`agent:aka`を入れるとDiscord peer配送を行わず内部queueへ送る。 | `src/infrastructure/tools/scheduled-task-tools.ts:17-25`、`src/infrastructure/tools/agent-send-tool.ts`、FR-88 | 設計判断後に実装。transport destinationをopaque routeとして明記し、peer配送は`respond.peer`に限定するか、明示変換を追加 |

## 分離済み、又は意図的に対象外の項目

- `agent_id`を持つ各主要tableはAgent所有で分離されている。Memory / Event / State / OutboxをAgent間で共有する経路は確認されなかった。
- `memory_subjects.subject_id`と`event_subjects.subject_id`は対象を表す非FKのcanonical IDであり、subject registry tableを持たない設計自体は#052と整合する。問題は現在のresolver未実装と、LLM由来の書込みである。
- Event / Run / Memory mutationの`sourceEventId`、`sourceRunId`、`causationId`、`correlationId`は監査・因果追跡用の参照であり、他者のidentityを表すsubjectではない。FKがないことだけを問題にはしない。
- Background Experienceの`participants`は架空経験内の自然言語であり、現在のUser / peer identityではない。current subjectへ自動統合しないことは分離として妥当である。
- `Memory.relatedSubjectIds`がretrieverで常に空なのは、現状canonical IDをLLMへ見せないための実装である。型名は誤解を招くが、この監査では独立したidentity漏洩とは判定しない。

## Issue 化を推奨する指摘

- #1、#3：#055を、peer YAMLの読込み・allowlist inbound・canonical resolver・model-facing raw ID除去・`agent_send`の扱いまで明示して実装する。
- #2、#4：Reflection Memoryの`subjects` / `source`と`sourceAgentId`を分離する変更Issueを作る。`sourceAgentId`を廃止するか、Agent identityとしてresolver検証するかは設計判断が必要。
- #5：scheduled task / internal agent sendのtransport宛先とsubject / Discord peer配送の関係を決める変更Issueを作る。

## 機械検査の結果

`trace_check.py`: ERROR 0件、WARN 8件、INFO 31件。FR-88は後続の#055 / #056未実装のためテスト未参照である。
