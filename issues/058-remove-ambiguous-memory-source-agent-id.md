---
created_at: 2026-11-20
status: created
type: change
plan: []
requirements: [FR-77, FR-89, NFR-7, NFR-8]
ui: []
requires: agent
---

# 058 Memoryの曖昧なsourceAgentIdを廃止する

元計画：ID / subject監査で確定したMemory所有・対象・根拠の分離

## Background

`memories.source_agent_id`と`memory_mutations.source_agent_id`はAgent IDのように見えるが、FKもcanonical resolverも持たず、Reflectionでは任意の情報源文字列が保存される。Memory owner、subject、因果根拠を分離するFR-89に従い、この曖昧な列を除去する。

## Dependencies

- 055

## Scope

- Memory / Memory mutation domain schema、writer、retriever、Reflection input / outputから`sourceAgentId`を除去する。
- 既存列をnullへbackfillするdry-run既定のmigration CLIを追加し、明示`--apply`時だけ書込みを行う。
- backfill確認後、Drizzle schemaから列を削除し、generated migrationでdropする。
- Reflectionはsubject又はsource IDを出力せず、RuntimeがEvent evidenceからsubjectを導出する。

## Out of scope

- Agent peer subjectのalias migration（057）
- 伝聞を表す新しいentityの追加

## Acceptance criteria

- [ ] AC-058-1：Memoryの所有者、対象、根拠がそれぞれ`agent_id`、`memory_subjects`、Event / Run / evidenceで表される。
- [ ] AC-058-2：LLM入力・出力・repair payloadに`sourceAgentId`、subject ID、evidence IDがない。
- [ ] AC-058-3：migrationはdry-run既定で件数を表示し、`--apply`時だけ既存値を除去する。
- [ ] AC-058-4：Drizzle generated migration後に`source_agent_id`列を参照するwriter / readerがない。

## Tests

- FR-77, FR-89：ReflectionとMemory writerがAgent / subject / evidence IDをLLM由来で保存しないことをunit / integration testで検証する。
- NFR-8：dry-run / apply migrationとDrizzle schema migrationをtest DBで検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | FR-89 | Memory identity / provenanceの分離 | `docs/REQUIREMENTS.md` |
| ADDED | ADR-22 | Memoryの正規化境界 | `docs/ARCHITECTURE.md` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/domain/contracts.ts` | Memory / update payload schema | 更新する |
| `src/infrastructure/persistence/schema.ts` | `source_agent_id`列 | 更新する |
| `src/infrastructure/persistence/memory-write-repository.ts` | writer / audit | 更新する |
| `src/infrastructure/persistence/postgres-reflection.ts` | Reflection input / commit | 更新する |
| `scripts/` | dry-run / apply data migration | 追加する |
| `tests/` | migration / ID-free contracts | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-09 / C-10 / C-24に従う。一次仕様変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-89 | 反映済み |
| `docs/ARCHITECTURE.md` | ADR-22 | 反映済み |
