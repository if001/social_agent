---
created_at: 2026-10-22
status: done
type: change
plan: []
requirements: [C-02, C-17, FR-33, FR-45, FR-46, FR-47, NFR-4]
requires: agent
---

# 006 Event種別ごとのruntime skillを導入する

元計画：なし（会話起点）

## Background

現状は単一のsystem promptに、user-message用、自律Event用、Concernライフサイクル用の指示が常時混在している。Tool公開はmiddlewareで一部制限しているが、promptはEvent種別で切り替わらない。そのためuser-messageでも「concern_listを使う」「deepen / bridge / distantを使う」といった自律Event向けの指示を読んだ状態になる。

`deepagents`の`skills`と`FilesystemBackend`を使えば、単一Agentのまま`SKILL.md`をprogressive disclosureでき、system promptには「このEventではこのskillを読む」という短いルーティングだけを置ける。

## Dependencies

なし

## Scope

- `skills/`にEvent種別ごとの`SKILL.md`を置く。
  - `user-message`
  - `idle`
  - `concern-due`
  - `scheduled-task`
  - `concern-lifecycle`（idle / concern-due共用）
- Agent Coreのsystem promptから、user-message固有のTool指示、自律EventのFlow、探索モード、Concernライフサイクルの本文を外す。
- system promptに、`event.kind`と`targetKind`から読む`SKILL.md`を選ぶ短いルーティングを追加する。
- `createDeepAgent`へ`FilesystemBackend`と`skills: ["/"]`を渡す。単一Agentを維持する。
- `autonomous-exploration-prompt.ts`を削除し、探索モードは`idle` skillへ移す。
- Tool公開境界は既存middlewareを維持する。skill本文に使うToolの目安を書き、実行時の強制はmiddlewareが担う。
- `skill_read`をRegistry Toolとして追加し、組み込み`read_file`は公開しない。SkillsMiddlewareの自動カタログはsystem promptから除去し、自前の短いルーティングだけを使う。`skill_read`はcontent-read policyで結果と上限を管理する。

## Out of scope

- Event種別ごとにDeep Agentを作り分けること。
- 出力SchemaをEvent種別に分けること。
- 既存Toolの削除やAction集合の変更（`skill_read`の追加と`read_file`非公開化を除く）。
- Skill本文をコードから動的生成すること。
- 正の文書の既存要件の変更（FR-47 / AC-10の追加とAC-9の実効prompt基準への更新を除く）。

## Implementation notes

- `deep-agent-prompt.ts`から`ToolとFlow`節を削除し、`Event skill`節へ置き換える。
- `deep-agent-harness.ts`の`completeAgentCoreSystemPrompt`を`agentCoreSystemPrompt`だけにし、`autonomousExplorationPrompt` / `concernLifecyclePrompt`の常時付与をやめる。
- `createOllamaDeepAgentInvoker`のデフォルトfactoryで`new FilesystemBackend({ rootDir: skillsRoot, virtualMode: true })`を作り、`skills: ["/"]`を渡す。
- `skillsRoot`は`OllamaDeepAgentConfig.skillsRoot`で上書きでき、既定は`process.cwd()/skills`とする。
- 各`SKILL.md`へ`name`、`description`、使うToolの目安、Flow別の短い指示を書く。`skill_read`の予算は1回1,200文字・run 4,000文字とし、通常のcontent-readを圧迫しない。
- `tests/unit/agent-prompts.test.ts`は、共通promptと各skillを分けて検証する。`listSkills`、`resolveEventSkills`、`FilesystemBackend`、`skill_read`、SkillsMiddlewareカタログ除去後の実効promptを確認する。
- contract testのidle固有文言は`skills/idle/SKILL.md`を参照する。

## Acceptance criteria

- [x] AC-10：`skills/`のmetadataが読み込まれ、user-message / idle / concern-due / scheduled-taskのskillへルーティングされる。
- [x] user-messageのpromptから自律Event固有の指示が除かれている。
- [x] 単一Agentの`createDeepAgent`に`skills`と`FilesystemBackend`が渡されている。
- [x] 既存のTool公開境界とAction契約が維持されている。
- [x] prompt、contract、unit、systemのtestが通る。
- [x] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- FR-47、AC-10：`listSkills`でskill metadataが読める。
- FR-47：system promptがEvent種別ごとの`SKILL.md`パスへルーティングする。
- FR-33：user-messageはuser-message skill、自律Eventはidle skillを参照する。
- FR-45：idle skillがrespond/refuseを通常経路とし、通知を代替にしない。
- FR-25、FR-44：concern-lifecycle skillがConcernの作成・継続・終了を制御する。
- FR-26、FR-27：idle skillがdeepen / bridge / distantを持つ。
- FR-12、FR-22：共通promptが出力Schemaを重複掲載しない。
- typecheck、lint、unit、system。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | FR-47 | Event種別ごとのruntime skillを読み、Tool・Flow・出力方針を切り替える | docs/REQUIREMENTS.md |
| ADDED | AC-10 | Event種別ごとのskill読み込みとルーティングをUnit testで確認する | docs/REQUIREMENTS.md |
| ADDED | Tool skill_read | Registry管理のskill読み込みTool。組み込みread_fileは公開しない | docs/ARCHITECTURE.md |
| MODIFIED | AC-9 | 実効system prompt 4,500文字以下（skill catalogはモデルへ渡す前に除去） | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`agentCoreSystemPrompt`、`completeAgentCoreSystemPrompt`、`autonomousExplorationPrompt`、`concernLifecyclePrompt`、`createDeepAgent`、`skills`

| 場所 | 内容 | 対応 |
|---|---|---|
| src/infrastructure/agent/deep-agent-prompt.ts | 共通promptとEvent skillルーティング | 更新する |
| src/infrastructure/agent/deep-agent-harness.ts | `skills` / `FilesystemBackend`の設定 | 更新する |
| src/infrastructure/agent/autonomous-exploration-prompt.ts | idle探索prompt | 削除する |
| skills/*/SKILL.md | Event種別ごとの指示 | 追加する |
| tests/unit/agent-prompts.test.ts | skill読み込み・ルーティング | 更新する |
| tests/contract/agent-harness.contract.test.ts | idle固有文言の参照先 | 更新する |
| docs/REQUIREMENTS.md | FR-47、AC-10 | 更新する |
| docs/ARCHITECTURE.md | system promptとskillの構成 | 更新する |
| docs/TEST_STRATEGY.md | FR-47、AC-10の検証対応 | 更新する |
| docs/AGENT_MOTIVATION_MODEL.md | 振る舞いの変更なし | 変更しない |
| spec/ | 決定変更なし | 変更しない |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-02 | 個性を固定行動にしない範囲でskillを使う | 不要 |
| spec/personal-agent-implementation-design-v2.md §11 | Eventごとのprompt構成は実装判断 | 不要 |
| docs/ARCHITECTURE.md | system promptとskillの構成 | 反映済み |
| docs/REQUIREMENTS.md | FR-47、AC-10、AC-9 | 反映済み |
| docs/TEST_STRATEGY.md | FR-47、AC-10、AC-9 | 反映済み |
| docs/AGENT_MOTIVATION_MODEL.md | 振る舞いの変更なし | 不要 |

## 実装メモ

- `skills/`に`user-message`、`idle`、`concern-due`、`scheduled-task`、`concern-lifecycle`の`SKILL.md`を追加した。
- Event skillのルーティングを`deep-agent-prompt.ts`へ追加し、user-message / idle / concern-due / scheduled-task / その他の読み分けを明示した。
- `completeAgentCoreSystemPrompt`を共通promptだけにし、`autonomousExplorationPrompt`と`concernLifecyclePrompt`の常時付与をやめた。`autonomous-exploration-prompt.ts`は削除した。
- `createOllamaDeepAgentInvoker`のデフォルトfactoryで`FilesystemBackend({ rootDir: skillsRoot, virtualMode: true })`と`skills: ["/"]`を`createDeepAgent`へ渡す。`skillsRoot`は設定で上書きできる。
- Tool公開境界は既存middlewareを維持し、skill本文のTool目安は説明用とした。組み込み`read_file`は公開せず、Registry Tool `skill_read`でskillを読む。
- 共通promptは2,594文字。SkillsMiddlewareのカタログはmiddlewareでsystem promptから除去するため、モデルへ渡す実効promptも2,594文字で、read_file指示を含まない。
- `skill_read`はRegistry Toolとしてcontent-read policy（1回1,200文字、run 4,000文字）で実行し、組み込み`read_file`は公開しない。
- テスト: `tests/unit/agent-prompts.test.ts`、`tests/contract/agent-harness.contract.test.ts`。
- 検証: typecheck、lint、unit 156件、system 43件、evaluation 14件が通過。
- レビュー記録: [docs/work/reviews/2026-10-22-issue-006.md](../docs/work/reviews/2026-10-22-issue-006.md)
