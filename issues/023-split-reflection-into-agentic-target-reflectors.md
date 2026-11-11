---
created_at: 2026-11-10
status: done
type: change
plan: []
requirements: [C-25, FR-41, FR-42, FR-44, FR-60, NFR-3, NFR-5, NFR-7, NFR-17, 追加]
requires: agent
---

# 023 Reflectionを対象別のagent的Reflectorへ分離する

元計画：なし（Issue 021で承認するReflection Session設計）

## Background

一括Reflectionは全State、Event、Memoryを単一LLM callへ与えるため、Concernが複数ある通常状態と両立しない。Reflectionは外部探索やAction生成ではなく、自身の監査記録を必要に応じて読み、対象別に長期Stateを更新するagent的なmaintenance処理へ分ける。

## Dependencies

- 021（保存経路監査、上流設計、migration baseline方針が反映済み）
- 022（Concern Activity、履歴取得Tool、決定論的close）

## Scope

- Reflection Sessionと、Memory / Concern / Relationship / SelfMood Reflectorを実装する。
- 各Reflectorに小さいprompt、専用Skill、読み取り専用Tool群、対象別の構造化出力schema、plan statusを持たせる。
- Memory → Concern / Relationship → SelfMoodの順に処理し、同一Sessionの根拠・確定結果を下流へ渡す。
- 各ReflectorのLLM選択Contextと完全なcommit基準Stateを分離する。
- Tool callは小さな読み取りを必要な回数だけ許可し、同一入力反復、Session外への無制限な探索、外部Tool利用だけを防ぐ。
- 対象別の成功・失敗・blockedを保存し、失敗対象だけ再試行する。
- Debug UIにSession、Reflector、Tool実行、対象別更新、決定論的closeを表示する。

## Out of scope

- 通常Agent CoreのTool loopやAction schemaの変更。
- Reflectionからユーザーへの発話、Web検索、外部副作用を発生させること。
- Concern Activityの保存契約自体の追加（022）。

## Implementation notes

- 既存の一括`ReflectionInput` / `ReflectionOutput`をそのまま各LLMに流用しない。Reflectorごとに必要最小限の入力・出力を持たせる。
- Memory ReflectorはEventと既存Memoryを読み、MemoryIntentだけを返す。
- Concern Reflectorは`concern_list`、`concern_get`、Concern Activity、関連Memory / Eventを読み、Concern差分だけを返す。
- Relationship Reflectorは今回の関係主体と関連Event / Memoryだけを読み、Relationship差分だけを返す。
- SelfMood Reflectorは確定したMemory、Concern、Relationshipの短い要点と現Self / Moodだけを読み、Self全体またはMood差分だけを返す。
- 各commitは完全Stateへ差分適用し、選択Contextに含まれないConcern・Relationshipを削除しない。

## Acceptance criteria

- [x] FR-41：Reflectionが対象別の長期統合処理として動作し、通常Actionや外部探索を行わない。
- [x] FR-42, NFR-3, NFR-5：各Reflectorは小さい入力、説明付きschema、repair、適切なTool loop予算を持つ。
- [x] FR-44：Concern ReflectorはMemory根拠のあるcreateと既存Concernの整理を行い、022の決定論的closeと競合しない。
- [x] FR-60, NFR-17：対象別にpending / completed / failed / blockedを保存し、失敗対象だけ再試行する。
- [x] NFR-7：Session、Reflector、Tool、根拠、State差分をDebug UIで追跡できる。

## Tests

- FR-41：Memory / Concern / Relationship / SelfMoodの実行順と、外部Actionが生じないsystem test。
- FR-42, NFR-3, NFR-5：各Reflectorが必要な読み取りToolを複数回利用でき、反復入力・予算超過・Schema不正から回復するtest。
- FR-44：Concern ReflectorがContext外のConcernをcommit時に失わないintegration test。
- FR-60, NFR-17：Memory失敗時の下流blockedと、対象別retryのintegration test。
- NFR-7：Debug repository / UIのtrace表示test。

## 差分

Issue 021で承認するFR / AC / ADRに従う。一次文書の変更はこのIssueでは行わない。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/application/reflection.ts` | Sessionと対象別orchestrator | 更新する |
| `src/infrastructure/agent/reflection-harness.ts` | 一括ReflectionからReflector harnessへ分割 | 更新する |
| `skills/reflection-*` | Reflector別Skill | 更新済み |
| `src/infrastructure/tools/*` | Reflector用読み取りTool公開 | 更新する |
| `src/infrastructure/persistence/postgres-reflection.ts` | Session、対象別input / output / commit / retry | 更新する |
| `src/bootstrap/bot-composition.ts` | Reflector構成 | 更新する |
| `src/debug-ui/*` | Session / Reflector trace | 更新する |
| `tests/unit`, `tests/system`, `tests/integration` | 順序、Tool loop、差分commit、retry | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| Issue 021 | 分割Reflectionとagent的取得の設計 | 反映済み |

## 実装結果

- `reflection_attempts`に対象別の入力・出力・Tool trace・状態を保存し、同一SessionではMemory確定後にState/Memoryを再読込して下流へ渡す。retryでも完了済みtargetの後に再読込する。
- retryable Sessionには`retry_count`を保存し、同じSessionの反復失敗でも指数backoffする。
- 各Reflectorは対象別の最小入力・専用schema・`skills/reflection-*`の指示を用い、`skill_read`とread-onlyの状態照会だけを許可する。
- Debug UIでReflection attemptとそのTool traceをSession単位で追える。
