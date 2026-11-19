---
created_at: 2026-11-19
status: doing
type: change
plan: []
requirements: [FR-6, FR-42, FR-77, FR-82, NFR-12, NFR-22]
ui: []
requires: human
---

# 051 User subjectを正規化し、Self / Relationshipの現在状態を圧縮する

元計画：shiroの実State監査と、ユーザー承認済みの修正方針

## Background

`agent_states.self_story`と`relationships`へ出来事の履歴が蓄積し、Current Self / Relationshipが現在の判断に必要な軽量状態でなくなっている。
また、Discord actor ID、別名、LLM出力IDがRelationship、Memory subject、Event subjectへ混在している。
これはLLMがcanonical IDを入出力せずRuntimeが解決するFR-42 / FR-77 / FR-82に反する。

ユーザーは、shiroの既存の5 subject aliasを全て`user-main`へ統合することを承認した。

## Dependencies

- 050（Debug UIで現在Self / Relationshipを観測可能）

## Scope

- human actorが`DISCORD_OWNER_IDS`に含まれる場合、Runtimeがcanonical subject `user-main`へ解決する。
- 未設定の他Bot / humanは、Relationshipとユーザー視点Memory / Event subjectの対象にしない。
- Experience Integration、Memory / Event subject書込み、`user_context_get`、recent action取得、検索filterをcanonical subject resolverへ統一する。
- Main Agent / Reflectorの`retrieval_search`、`memory_search`、`user_context_get`、`relationship_search`から永続的なsubject IDの入力・出力を除去し、現在のユーザー対象はRuntimeが解決する。
- ReflectionのLLM outputから`subjectId`を除去し、`user-main`へのRelationship変更だけをRuntimeが適用する。
- `selfStory`を600文字以内、Relationship descriptionを400文字以内に制限する。
- Self / RelationshipのLLM向けdescription・Skillを、現在の持続状態だけを要約し、出来事の時系列列挙をMemoryへ残す内容へ修正する。
- 既存のshiro alias、`memory_subjects`、`event_subjects`、Relationshipを`user-main`へ統合するdry-run既定のmigration scriptを作成する。
- 既存の長いSelf / Relationshipを実LLMで一度だけ圧縮するコマンドを作成する。実DBへの適用は人が明示的に実行する。

## Out of scope

- 複数の人間ユーザーを同時に区別するsubject model
- 他Botのcanonical subject設定。未設定時はno-opとする（#052）。
- Memory本文の再要約・削除

## Detailed design

### Canonical subject

- `user-main`はAgentごとに一意な現在の人間ユーザーを表す定数とする。
- Runtimeは`actor.type === human`かつ`actor.id ∈ DISCORD_OWNER_IDS`のときだけ`user-main`を返す。
- `actor.type === agent`、owner外のhuman、actorなしは`undefined`を返す。
- Eventの生actor IDはObservationに監査用として残す。subject索引とRelationshipだけがcanonical subjectを使う。
- LLM Toolの対象指定は永続IDではなく、現在のEventのユーザーを意味する固定scopeだけを使う。scopeを指定しない検索はsubject filterを付けない。

### State compactness

- `selfStory`は、現在の自己理解・継続する役割・現在の変化だけを最大600文字で表す。
- Relationship descriptionは、現在の関係の型、会話上の安定した前提、未解決の約束だけを最大400文字で表す。
- 個別の出来事、調査結果、日付列挙、出典列挙、完了済みTaskの履歴はMemory / Scheduled Taskに残し、Self / Relationshipへ重複させない。
- LLMは自然言語の圧縮と更新可否だけを判断する。対象subject、入力範囲、書込み対象はRuntimeが決定する。

### Reflection relationship output

- Relationship Reflectorは`operation`と`description`だけを返す。`subjectId`、Memory ID、Event ID等を出力しない。
- Runtimeは`user-main`の既存Relationshipだけをupsert / removeする。対象が存在せず、user subjectの根拠がSessionにない場合はno-opとする。

### Migration and compaction

- migration scriptは`--agent-id shiro --apply`を明示しない限り変更しない。
- `memory_subjects`と`event_subjects`は、承認済みaliasを`user-main`へ置換し、主キー衝突は重複除去する。
- `agent_states.relationships`は5 aliasを一つの`user-main`候補へ集約する。
- compaction commandは、現在のSelf、集約前Relationship、関連Memoryの自然言語viewを実LLMへ渡し、schemaで上限を検証する。DB更新は`--apply`でのみ行う。

## Acceptance criteria

- [x] AC-051-1：ownerのhuman actorから書かれるRelationship、Memory subject、Event subjectは`user-main`である。
- [x] AC-051-2：owner外または未設定のagent actorはRelationship、ユーザー視点Memory subject、Event subjectを更新しない。
- [x] AC-051-3：ReflectionのLLM schema / repair / tool viewに`subjectId`等の永続IDが含まれず、Runtimeが`user-main`だけを更新する。
- [x] AC-051-4：Self Storyは600文字、Relationship descriptionは400文字を超えて永続化できず、履歴列挙を避ける指示を持つ。
- [x] AC-051-5：migration scriptはdry-run既定で、承認済みshiro aliasを`user-main`へ統合できる。
- [x] AC-051-6：実LLM compaction commandはdry-run既定で、`--apply`時だけ有効な上限内のSelf / Relationshipへ更新する。

## 実施前の運用手順

実運用の既存値には上限超過のSelf / Relationshipがあるため、コードを稼働させる前に人が次の順で実行する。両コマンドは`--apply`なしではDBを更新しない。

1. `pnpm subject:canonicalize -- --agent-id shiro` で対象数を確認し、`--apply`付きでaliasを`user-main`へ統合する。
2. `pnpm state:compact -- --agent-id shiro` でLLMの圧縮案を確認し、問題なければ`--apply`付きでCurrent Stateを上限内へ更新する。

## Tests

- FR-42, FR-77, FR-82, NFR-22：actorからcanonical subjectをRuntimeが解決し、LLM outputがID-freeであることをunit / integration testで検証する。
- FR-6：Self StoryとRelationshipの上限・現在状態の説明契約をschema / Reflection testで検証する。
- NFR-12：Debug UIがcanonical Relationshipを読取り表示できることを検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-6 | Current Selfの現在状態・上限を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-42 | Relationship ReflectorのID-free出力を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-77 | subject解決をRuntime責務として明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-82 | actorからcanonical subjectを解決する規則を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-20 | canonical subject resolverをRuntime所有とする | `docs/ARCHITECTURE.md` |

## 影響範囲

検索した語：`subjectId`、`relationshipChanges`、`memorySubjects`、`eventSubjects`、`DISCORD_OWNER_IDS`、`selfStory`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/application/experience-integration.ts` | actor由来subjectの決定 | 更新する |
| `src/infrastructure/persistence/postgres-experience-integration.ts` | Relationship / subject索引のcommit | 更新する |
| `src/infrastructure/agent/reflection-harness.ts` | Relationship Reflector schema | 更新する |
| `src/infrastructure/persistence/postgres-reflection.ts` | Relationship target解決とcommit | 更新する |
| `src/infrastructure/tools/agent-context-tools.ts` | user context / relationship検索 | 更新する |
| `src/infrastructure/persistence/postgres-agent-context-tool-repository.ts` | actor / recent action検索 | 更新する |
| `src/infrastructure/tools/retrieval-tools.ts` | LLM向けsubject filter | 更新する |
| `src/domain/contracts.ts` | Current Self / Relationship上限 | 更新する |
| `scripts/` | migration・compaction command | 追加する |
| `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md` | Runtime責務・上限 | 更新する |
| `spec/` | 既存のC-09、C-18、C-20に整合する詳細化 | 更新しない |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | なし。C-09とC-18 / C-20の既存原則に従う | 不要 |
| `docs/REQUIREMENTS.md` | Current Self / canonical subject / ID-free Reflectorの詳細化 | 未着手 |
| `docs/ARCHITECTURE.md` | canonical subject resolverのRuntime所有 | 未着手 |
